"""
Phase 1 REST API — text-only interview loop.

POST /session  → create session, get first question
POST /answer   → submit answer, get next question (or completion signal)
GET  /session/{id} → fetch full session state (for debugging)
POST /session/{id}/end → force-end session, trigger Recruiter Agent
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.agents.difficulty_manager import update_session_state
from app.agents.evaluator import run_evaluator_agent
from app.agents.interviewer import run_interviewer_agent
from app.agents.recruiter import run_recruiter_agent
from app.config import settings
from app.db.database import get_pg_pool, get_redis
from app.models.types import (
    InterviewMode,
    InterviewPhase,
    InterviewSession,
    QuestionRecord,
    QuestionType,
    SessionState,
    SpeechMetrics,
    TargetCompany,
    TargetRole,
    UserAnswer,
)

router = APIRouter()

# ─── Redis key helpers ────────────────────────────────────────────────────────

def _state_key(session_id: str) -> str:
    return f"session:{session_id}:state"


def _history_key(session_id: str) -> str:
    return f"session:{session_id}:history"


# ─── Persistence helpers ──────────────────────────────────────────────────────

async def _load_state(session_id: str) -> SessionState:
    redis = await get_redis()
    raw = await redis.get(_state_key(session_id))
    if not raw:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found or expired.")
    return SessionState.model_validate_json(raw)


async def _save_state(session_id: str, state: SessionState) -> None:
    redis = await get_redis()
    await redis.setex(
        _state_key(session_id),
        settings.session_ttl_seconds,
        state.model_dump_json(),
    )


async def _load_history(session_id: str) -> list[QuestionRecord]:
    redis = await get_redis()
    raw = await redis.get(_history_key(session_id))
    if not raw:
        return []
    data = json.loads(raw)
    return [QuestionRecord.model_validate(item) for item in data]


async def _save_history(session_id: str, history: list[QuestionRecord]) -> None:
    redis = await get_redis()
    payload = json.dumps([qr.model_dump(mode="json") for qr in history])
    await redis.setex(_history_key(session_id), settings.session_ttl_seconds, payload)


async def _persist_question_record(session_id: str, qr: QuestionRecord) -> None:
    """Write a fully-populated QuestionRecord to PostgreSQL."""
    pool = await get_pg_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO question_records
                (id, session_id, question_text, question_type, follow_up_type,
                 parent_question_id, difficulty_level, topic, asked_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT (id) DO NOTHING
            """,
            uuid.UUID(qr.id),
            uuid.UUID(session_id),
            qr.question_text,
            qr.question_type.value,
            qr.follow_up_type.value if qr.follow_up_type else None,
            uuid.UUID(qr.parent_question_id) if qr.parent_question_id else None,
            qr.difficulty_level,
            qr.topic,
            qr.asked_at,
        )

        if qr.user_answer:
            ua = qr.user_answer
            sm = ua.speech_metrics
            await conn.execute(
                """
                INSERT INTO user_answers
                    (id, question_record_id, transcript, audio_url, duration_seconds,
                     wpm, filler_word_count, filler_word_list, pause_count,
                     avg_pause_duration_ms, sentence_completion_rate, hedge_word_count,
                     technical_term_density, confidence_score)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                ON CONFLICT (question_record_id) DO NOTHING
                """,
                uuid.uuid4(),
                uuid.UUID(qr.id),
                ua.transcript,
                ua.audio_url,
                ua.duration_seconds,
                sm.wpm,
                sm.filler_word_count,
                sm.filler_word_list,
                sm.pause_count,
                sm.avg_pause_duration_ms,
                sm.sentence_completion_rate,
                sm.hedge_word_count,
                sm.technical_term_density,
                sm.confidence_score,
            )

        if qr.evaluation:
            ev = qr.evaluation
            await conn.execute(
                """
                INSERT INTO answer_evaluations
                    (id, question_record_id,
                     technical_correctness_value, technical_correctness_rationale,
                     explanation_clarity_value, explanation_clarity_rationale,
                     structured_reasoning_value, structured_reasoning_rationale,
                     edge_case_handling_value, edge_case_handling_rationale,
                     time_complexity_awareness_value, time_complexity_awareness_rationale,
                     tradeoff_discussion_value, tradeoff_discussion_rationale,
                     star_structure_value, star_structure_rationale,
                     strengths, gaps, missed_concepts, interviewer_internal_note)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
                ON CONFLICT (question_record_id) DO NOTHING
                """,
                uuid.uuid4(),
                uuid.UUID(qr.id),
                ev.technical_correctness.value,
                ev.technical_correctness.rationale,
                ev.explanation_clarity.value,
                ev.explanation_clarity.rationale,
                ev.structured_reasoning.value,
                ev.structured_reasoning.rationale,
                ev.edge_case_handling.value,
                ev.edge_case_handling.rationale,
                ev.time_complexity_awareness.value,
                ev.time_complexity_awareness.rationale,
                ev.tradeoff_discussion.value,
                ev.tradeoff_discussion.rationale,
                ev.star_structure.value,
                ev.star_structure.rationale,
                ev.strengths,
                ev.gaps,
                ev.missed_concepts,
                ev.interviewer_internal_note,
            )


# ─── Request / Response models ────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    user_id: str
    mode: InterviewMode
    target_role: TargetRole
    target_company: TargetCompany


class QuestionResponse(BaseModel):
    id: str
    question_text: str
    question_type: str
    follow_up_type: str | None
    difficulty_level: int
    topic: str | None = None


class CreateSessionResponse(BaseModel):
    session_id: str
    question: QuestionResponse
    phase: str
    difficulty_level: int


class SubmitAnswerRequest(BaseModel):
    session_id: str
    transcript: str
    duration_seconds: float = 60.0


class SubmitAnswerResponse(BaseModel):
    question: QuestionResponse | None
    is_complete: bool
    phase: str
    difficulty_level: int
    question_count: int


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.post("/session", response_model=CreateSessionResponse)
async def create_session(req: CreateSessionRequest) -> CreateSessionResponse:
    session_id = str(uuid.uuid4())
    state = SessionState()

    # Persist session row to PostgreSQL
    pool = await get_pg_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO interview_sessions (id, user_id, mode, target_role, target_company)
            VALUES ($1, $2, $3, $4, $5)
            """,
            uuid.UUID(session_id),
            req.user_id,
            req.mode.value,
            req.target_role.value,
            req.target_company.value,
        )

    # Store state + empty history in Redis
    await _save_state(session_id, state)
    await _save_history(session_id, [])

    # Get the opening question from the Interviewer Agent
    output = await run_interviewer_agent(
        state=state,
        last_evaluation=None,
        recent_questions=[],
        target_role=req.target_role,
        target_company=req.target_company,
    )

    # Create the question record (no answer yet)
    question_id = str(uuid.uuid4())
    qr = QuestionRecord(
        id=question_id,
        question_text=output.question_text,
        question_type=output.question_type,
        follow_up_type=output.follow_up_type,
        difficulty_level=state.difficulty_level,
        topic="",
        asked_at=datetime.now(timezone.utc),
    )

    # Save to history in Redis (answer will be attached on next /answer call)
    await _save_history(session_id, [qr])
    # Persist the question row to PostgreSQL now (answer inserted later)
    await _persist_question_record(session_id, qr)

    return CreateSessionResponse(
        session_id=session_id,
        question=QuestionResponse(
            id=qr.id,
            question_text=qr.question_text,
            question_type=qr.question_type.value,
            follow_up_type=qr.follow_up_type.value if qr.follow_up_type else None,
            difficulty_level=qr.difficulty_level,
        ),
        phase=state.interview_phase.value,
        difficulty_level=state.difficulty_level,
    )


@router.post("/answer", response_model=SubmitAnswerResponse)
async def submit_answer(req: SubmitAnswerRequest) -> SubmitAnswerResponse:
    # Load Redis state + session metadata from DB concurrently
    pool = await get_pg_pool()
    state, history, row = await asyncio.gather(
        _load_state(req.session_id),
        _load_history(req.session_id),
        pool.fetchrow(
            "SELECT mode, target_role, target_company, started_at FROM interview_sessions WHERE id = $1",
            uuid.UUID(req.session_id),
        ),
    )

    if not row:
        raise HTTPException(status_code=404, detail="Session not found in database.")
    if not history:
        raise HTTPException(status_code=400, detail="No active question found for this session.")

    current_qr = history[-1]
    if current_qr.user_answer is not None:
        raise HTTPException(status_code=400, detail="Current question already answered.")

    mode         = InterviewMode(row["mode"])
    target_role  = TargetRole(row["target_role"])
    target_company = TargetCompany(row["target_company"])
    elapsed = int((datetime.now(timezone.utc) - row["started_at"].replace(tzinfo=timezone.utc)).total_seconds())

    speech_metrics = SpeechMetrics.text_only_default(req.transcript, req.duration_seconds)
    current_qr.user_answer = UserAnswer(
        transcript=req.transcript,
        duration_seconds=req.duration_seconds,
        speech_metrics=speech_metrics,
    )

    # Evaluator runs first (its output drives Difficulty Manager + Interviewer)
    evaluation = await run_evaluator_agent(
        mode=mode,
        target_role=target_role,
        target_company=target_company,
        question_text=current_qr.question_text,
        question_type=current_qr.question_type.value,
        transcript=req.transcript,
    )
    current_qr.evaluation = evaluation

    new_state = update_session_state(state, evaluation, elapsed)
    is_complete = new_state.interview_phase == InterviewPhase.CLOSING
    next_question_response: QuestionResponse | None = None

    if not is_complete:
        output = await run_interviewer_agent(
            state=new_state,
            last_evaluation=evaluation,
            recent_questions=history,
            target_role=target_role,
            target_company=target_company,
        )

        is_complete = output.action.value == "close"

        if not is_complete:
            if output.action.value == "follow_up":
                new_state.follow_up_depth += 1
            else:
                new_state.follow_up_depth = 0

            if output.question_type != QuestionType.FOLLOWUP:
                if new_state.current_topic and new_state.current_topic not in new_state.topics_seen:
                    new_state.topics_seen.append(new_state.current_topic)

            new_qr = QuestionRecord(
                id=str(uuid.uuid4()),
                question_text=output.question_text,
                question_type=output.question_type,
                follow_up_type=output.follow_up_type,
                parent_question_id=current_qr.id if output.action.value == "follow_up" else None,
                difficulty_level=new_state.difficulty_level,
                topic=new_state.current_topic,
                asked_at=datetime.now(timezone.utc),
            )
            history.append(new_qr)
            await _persist_question_record(req.session_id, new_qr)

            next_question_response = QuestionResponse(
                id=new_qr.id,
                question_text=new_qr.question_text,
                question_type=new_qr.question_type.value,
                follow_up_type=new_qr.follow_up_type.value if new_qr.follow_up_type else None,
                difficulty_level=new_qr.difficulty_level,
                topic=new_qr.topic,
            )

    # Persist the answered question record
    await _persist_question_record(req.session_id, current_qr)

    # Save updated state and history
    # Persist only the last 5 questions in Redis (rest live in PostgreSQL)
    await _save_history(req.session_id, history[-5:])
    await _save_state(req.session_id, new_state)

    if is_complete:
        # Fire Recruiter Agent asynchronously — don't block the response
        asyncio.create_task(
            _finalize_session(req.session_id, mode, target_role, target_company, history, new_state, elapsed)
        )

    return SubmitAnswerResponse(
        question=next_question_response,
        is_complete=is_complete,
        phase=new_state.interview_phase.value,
        difficulty_level=new_state.difficulty_level,
        question_count=new_state.question_count,
    )


async def _finalize_session(
    session_id: str,
    mode: InterviewMode,
    target_role: TargetRole,
    target_company: TargetCompany,
    history: list[QuestionRecord],
    state: SessionState,
    duration_seconds: int,
) -> None:
    max_difficulty = max((qr.difficulty_level for qr in history), default=1)
    report = await run_recruiter_agent(
        target_role=target_role,
        target_company=target_company,
        mode=mode,
        duration_seconds=duration_seconds,
        question_history=history,
        weak_areas=list(set(state.weak_areas)),
        max_difficulty_reached=max_difficulty,
    )

    now = datetime.now(timezone.utc)
    pool = await get_pg_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE interview_sessions
            SET final_state = $1, final_report = $2, ended_at = $3, duration_seconds = $4
            WHERE id = $5
            """,
            state.model_dump_json(),
            report.model_dump_json(),
            now,
            duration_seconds,
            uuid.UUID(session_id),
        )


@router.get("/session/{session_id}")
async def get_session(session_id: str) -> dict:
    pool = await get_pg_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM interview_sessions WHERE id = $1",
            uuid.UUID(session_id),
        )
    if not row:
        raise HTTPException(status_code=404, detail="Session not found.")
    return dict(row)


@router.post("/session/{session_id}/end")
async def end_session(session_id: str) -> dict:
    """Force-end a session and generate the final report."""
    state = await _load_state(session_id)
    history = await _load_history(session_id)

    pool = await get_pg_pool()
    row = await pool.fetchrow(
        "SELECT mode, target_role, target_company, started_at FROM interview_sessions WHERE id = $1",
        uuid.UUID(session_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Session not found.")

    mode = InterviewMode(row["mode"])
    target_role = TargetRole(row["target_role"])
    target_company = TargetCompany(row["target_company"])
    elapsed = int((datetime.now(timezone.utc) - row["started_at"].replace(tzinfo=timezone.utc)).total_seconds())

    await _finalize_session(session_id, mode, target_role, target_company, history, state, elapsed)
    return {"status": "ended", "session_id": session_id}


@router.get("/session/{session_id}/report")
async def get_report(session_id: str) -> dict:
    """Poll this endpoint until ready=true, then read the report field."""
    pool = await get_pg_pool()
    row = await pool.fetchrow(
        "SELECT final_report FROM interview_sessions WHERE id = $1",
        uuid.UUID(session_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"ready": bool(row["final_report"]), "report": row["final_report"]}
