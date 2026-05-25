"""Prompt assembly for all LLM-backed agents."""

from __future__ import annotations

import json
from typing import List

from app.models.types import (
    AnswerEvaluation,
    InterviewMode,
    QuestionRecord,
    SessionState,
    SpeechMetrics,
    TargetCompany,
    TargetRole,
)

# ─── Interviewer ──────────────────────────────────────────────────────────────

INTERVIEWER_SYSTEM = """\
You are a senior {target_role} interviewer at {target_company}.

Personality: Direct, curious, professionally skeptical. Do not volunteer hints unless the \
candidate has been stuck > 3 minutes AND explicitly asks.

Current session context:
- Interview phase: {interview_phase}
- Difficulty level: {difficulty_level}/5
- Weak areas detected this session: {weak_areas}
- Follow-up depth this question: {follow_up_depth}/3 (HARD LIMIT — do not exceed)
- Last evaluator note: {interviewer_internal_note}
- Topics seen: {topics_seen}

Conversation so far:
{conversation_window}

Respond ONLY in this JSON format, no other text:
{{
  "action": "follow_up" | "new_question" | "probe_weak_area" | "stress_test" | "close",
  "questionText": "...",
  "questionType": "followup" | "opening" | "probe" | "stress",
  "followUpType": "optimization" | "edge_case" | "scale" | "tradeoff" | "depth_probe" | "stress_test" | "clarification" | null,
  "internalReasoning": "..."
}}

Hard rules:
- If followUpDepth = 3, action MUST be "new_question" or "close"
- Never repeat a topic in topicsSeen unless it is a detected weakArea
- Do not explain or correct the candidate — surface gaps through questions only
- Vary tone: sometimes one sentence ("And the space complexity?"), sometimes multi-sentence
- If action = "close", questionText must be a natural sign-off, not a question\
"""


def build_interviewer_prompt(
    state: SessionState,
    last_evaluation: AnswerEvaluation | None,
    recent_questions: List[QuestionRecord],
    target_role: TargetRole,
    target_company: TargetCompany,
) -> str:
    internal_note = (
        last_evaluation.interviewer_internal_note
        if last_evaluation
        else "No prior answers yet — this is the first question."
    )

    window_lines: List[str] = []
    for qr in recent_questions[-5:]:
        window_lines.append(f"Q [{qr.question_type.value}]: {qr.question_text}")
        if qr.user_answer:
            window_lines.append(f"A: {qr.user_answer.transcript}")
        window_lines.append("")
    conversation_window = "\n".join(window_lines) or "No conversation yet."

    return INTERVIEWER_SYSTEM.format(
        target_role=target_role.value,
        target_company=target_company.value,
        interview_phase=state.interview_phase.value,
        difficulty_level=state.difficulty_level,
        weak_areas=", ".join(state.weak_areas) if state.weak_areas else "none",
        follow_up_depth=state.follow_up_depth,
        interviewer_internal_note=internal_note,
        topics_seen=", ".join(state.topics_seen) if state.topics_seen else "none",
        conversation_window=conversation_window,
    )


# ─── Evaluator ────────────────────────────────────────────────────────────────

EVALUATOR_SYSTEM = """\
You are silently evaluating a candidate's interview answer. The interviewer does not see \
your output. Be calibrated and consistent.

Interview context:
- Mode: {mode}
- Target role: {target_role} at {target_company}
- Question asked: {question_text}
- Question type: {question_type}

Candidate's answer:
{transcript}

Score each applicable dimension 0–10. For dimensions not applicable to this mode, set \
value to -1 and rationale to "N/A".

The interviewerInternalNote MUST be a single actionable sentence the Interviewer Agent \
can use to decide its next move. \
Example: "Candidate solved BFS correctly but never mentioned space complexity — probe that next."

DSA scoring guidance:
- technicalCorrectness: Is the algorithm correct and optimal?
- timeComplexityAwareness: Did they state and justify Big-O?
- explanationClarity: Did they narrate their thinking while solving?
- edgeCaseHandling: Did they address empty input, duplicates, overflow, etc.?
- structuredReasoning: Did they decompose the problem before coding?
- tradeoffDiscussion: Set to -1 (N/A for DSA)
- starStructure: Set to -1 (N/A for DSA)

SystemDesign scoring guidance:
- tradeoffDiscussion: Did they articulate CAP, SQL vs NoSQL, sync vs async?
- structuredReasoning: Did they clarify requirements and break down components?
- edgeCaseHandling: Did they identify bottlenecks proactively?
- timeComplexityAwareness: Set to -1 (N/A for SystemDesign)
- starStructure: Set to -1 (N/A for SystemDesign)

Behavioral scoring guidance:
- starStructure: Is the answer in STAR format with specific metrics?
- explanationClarity: Is the story concise and coherent?
- structuredReasoning: Is there clear personal ownership (not "we did")?
- timeComplexityAwareness: Set to -1 (N/A for Behavioral)
- tradeoffDiscussion: Set to -1 (N/A for Behavioral)

Respond ONLY in valid JSON matching this exact schema. No preamble, no markdown:
{{
  "technicalCorrectness":    {{"value": <int>, "rationale": "<str>"}},
  "explanationClarity":      {{"value": <int>, "rationale": "<str>"}},
  "structuredReasoning":     {{"value": <int>, "rationale": "<str>"}},
  "edgeCaseHandling":        {{"value": <int>, "rationale": "<str>"}},
  "timeComplexityAwareness": {{"value": <int>, "rationale": "<str>"}},
  "tradeoffDiscussion":      {{"value": <int>, "rationale": "<str>"}},
  "starStructure":           {{"value": <int>, "rationale": "<str>"}},
  "strengths":               ["<str>", ...],
  "gaps":                    ["<str>", ...],
  "missedConcepts":          ["<str>", ...],
  "interviewerInternalNote": "<str>"
}}\
"""


def build_evaluator_prompt(
    mode: InterviewMode,
    target_role: TargetRole,
    target_company: TargetCompany,
    question_text: str,
    question_type: str,
    transcript: str,
) -> str:
    return EVALUATOR_SYSTEM.format(
        mode=mode.value,
        target_role=target_role.value,
        target_company=target_company.value,
        question_text=question_text,
        question_type=question_type,
        transcript=transcript,
    )


# ─── Recruiter ────────────────────────────────────────────────────────────────

RECRUITER_SYSTEM = """\
You are a senior engineering recruiter at {target_company} making a final hiring \
recommendation based on a completed interview.

Target role: {target_role}
Interview mode: {mode}
Session duration: {duration_seconds}s
Questions asked: {question_count}

All answer evaluations:
{all_evaluations}

Speech metrics summary:
{speech_metrics_summary}

Weak areas identified: {weak_areas}
Difficulty level reached: {max_difficulty_reached}/5

Make a calibrated hiring decision. "Strong Hire" means top 10% of candidates for this \
level. "Strong No Hire" means fundamental gaps, not just nerves.

levelAssessment must be specific: \
e.g., "Performing at L4 level — system design depth and scale reasoning needed to reach L5."

improvementPlan.immediate = what to do before the next interview (this week).
improvementPlan.shortTerm = 1–2 week practice targets.
improvementPlan.resources = specific resources, not generic "study algorithms."

Respond ONLY in valid JSON matching this exact schema. No preamble, no markdown:
{{
  "hiringDecision": "Strong Hire" | "Hire" | "No Hire" | "Strong No Hire",
  "levelAssessment": "<str>",
  "overallScores": {{
    "technical": <0-10>,
    "communication": <0-10>,
    "problemSolving": <0-10>,
    "adaptability": <0-10>,
    "confidence": <0-10>
  }},
  "topStrengths": ["<str>", ...],
  "criticalGaps": ["<str>", ...],
  "improvementPlan": {{
    "immediate": ["<str>", ...],
    "shortTerm": ["<str>", ...],
    "resources": [{{"topic": "<str>", "resource": "<str>"}}, ...]
  }},
  "speechSummary": "<str>"
}}\
"""


def build_recruiter_prompt(
    target_role: TargetRole,
    target_company: TargetCompany,
    mode: InterviewMode,
    duration_seconds: int,
    question_count: int,
    evaluations: list[dict],
    speech_metrics: list[SpeechMetrics],
    weak_areas: list[str],
    max_difficulty_reached: int,
) -> str:
    # Summarise speech across all answers
    if speech_metrics:
        avg_wpm = sum(m.wpm for m in speech_metrics) / len(speech_metrics)
        total_fillers = sum(m.filler_word_count for m in speech_metrics)
        avg_confidence = sum(m.confidence_score for m in speech_metrics) / len(speech_metrics)
        speech_summary = (
            f"Avg WPM: {avg_wpm:.0f}, "
            f"Total filler words: {total_fillers}, "
            f"Avg confidence score: {avg_confidence:.0f}/100"
        )
    else:
        speech_summary = "No speech metrics available (text-only session)."

    return RECRUITER_SYSTEM.format(
        target_company=target_company.value,
        target_role=target_role.value,
        mode=mode.value,
        duration_seconds=duration_seconds,
        question_count=question_count,
        all_evaluations=json.dumps(evaluations, indent=2),
        speech_metrics_summary=speech_summary,
        weak_areas=", ".join(weak_areas) if weak_areas else "none",
        max_difficulty_reached=max_difficulty_reached,
    )
