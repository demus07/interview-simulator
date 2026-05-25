from __future__ import annotations

import uuid
from collections import Counter
from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class InterviewMode(str, Enum):
    DSA = "DSA"
    SYSTEM_DESIGN = "SystemDesign"
    BEHAVIORAL = "Behavioral"


class TargetRole(str, Enum):
    SWE_L3 = "SWE-L3"
    SWE_L4 = "SWE-L4"
    SWE_L5 = "SWE-L5"
    EM = "EM"
    PM = "PM"


class TargetCompany(str, Enum):
    META = "Meta"
    GOOGLE = "Google"
    AMAZON = "Amazon"
    APPLE = "Apple"
    MICROSOFT = "Microsoft"
    GENERIC = "Generic"


class InterviewPhase(str, Enum):
    WARMUP = "warmup"
    CORE = "core"
    DEEP_DIVE = "deep-dive"
    STRESS_TEST = "stress-test"
    CLOSING = "closing"


class QuestionType(str, Enum):
    OPENING = "opening"
    FOLLOWUP = "followup"
    PROBE = "probe"
    CLARIFICATION = "clarification"
    STRESS = "stress"


class FollowUpType(str, Enum):
    OPTIMIZATION = "optimization"
    EDGE_CASE = "edge_case"
    SCALE = "scale"
    TRADEOFF = "tradeoff"
    DEPTH_PROBE = "depth_probe"
    STRESS_TEST = "stress_test"
    CLARIFICATION = "clarification"


class HiringDecision(str, Enum):
    STRONG_HIRE = "Strong Hire"
    HIRE = "Hire"
    NO_HIRE = "No Hire"
    STRONG_NO_HIRE = "Strong No Hire"


class InterviewerAction(str, Enum):
    FOLLOW_UP = "follow_up"
    NEW_QUESTION = "new_question"
    PROBE_WEAK_AREA = "probe_weak_area"
    STRESS_TEST = "stress_test"
    CLOSE = "close"


# -1 means N/A (dimension not applicable to this interview mode)
class Score(BaseModel):
    value: int = Field(ge=-1, le=10)
    rationale: str


class SpeechMetrics(BaseModel):
    wpm: float = 0.0
    filler_word_count: int = 0
    filler_word_list: List[str] = Field(default_factory=list)
    pause_count: int = 0
    avg_pause_duration_ms: float = 0.0
    sentence_completion_rate: float = 1.0
    hedge_word_count: int = 0
    technical_term_density: float = 0.0
    confidence_score: float = Field(default=50.0, ge=0, le=100)

    @classmethod
    def compute(
        cls,
        transcript: str,
        duration_seconds: float,
        speech_confidence: float | None = None,
        pause_count: int | None = None,
    ) -> "SpeechMetrics":
        """Compute speech metrics from transcript text, optionally overriding with real voice API values."""
        words = transcript.split()
        word_count = max(len(words), 1)
        wpm = (word_count / max(duration_seconds, 1)) * 60

        filler_list = ["um", "uh", "like", "you know", "sort of", "kind of", "basically", "literally"]
        hedge_list = ["i think", "maybe", "probably", "i'm not sure but", "i guess", "might be"]
        lower = transcript.lower()

        fillers = [w for w in filler_list if w in lower]
        hedges = [h for h in hedge_list if h in lower]

        filler_rate = len(fillers) / word_count
        hedge_rate = len(hedges) / word_count
        wpm_score = 1.0 if 120 <= wpm <= 160 else max(0.0, 1 - abs(wpm - 140) / 140)

        text_confidence = (
            (1 - filler_rate) * 0.35
            + (1 - hedge_rate) * 0.35
            + wpm_score * 0.30
        ) * 100

        # Real voice API confidence (0–1) takes precedence over text-derived estimate
        final_confidence = (speech_confidence * 100) if speech_confidence is not None else text_confidence

        return cls(
            wpm=round(wpm, 1),
            filler_word_count=len(fillers),
            filler_word_list=fillers,
            pause_count=pause_count if pause_count is not None else 0,
            avg_pause_duration_ms=0.0,
            sentence_completion_rate=1.0,
            hedge_word_count=len(hedges),
            technical_term_density=0.0,
            confidence_score=round(min(100.0, max(0.0, final_confidence)), 1),
        )

    @classmethod
    def text_only_default(cls, transcript: str, duration_seconds: float) -> "SpeechMetrics":
        return cls.compute(transcript, duration_seconds)


class AnswerEvaluation(BaseModel):
    technical_correctness: Score
    explanation_clarity: Score
    structured_reasoning: Score
    edge_case_handling: Score
    time_complexity_awareness: Score  # DSA only; value=-1 if N/A
    tradeoff_discussion: Score        # SystemDesign only
    star_structure: Score             # Behavioral only
    strengths: List[str]
    gaps: List[str]
    missed_concepts: List[str]
    interviewer_internal_note: str


class UserAnswer(BaseModel):
    transcript: str
    audio_url: Optional[str] = None
    duration_seconds: float
    speech_metrics: SpeechMetrics


class QuestionRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    question_text: str
    question_type: QuestionType
    follow_up_type: Optional[FollowUpType] = None
    parent_question_id: Optional[str] = None
    difficulty_level: int = Field(ge=1, le=5)
    topic: str
    user_answer: Optional[UserAnswer] = None
    evaluation: Optional[AnswerEvaluation] = None
    asked_at: datetime = Field(default_factory=datetime.utcnow)


class SessionState(BaseModel):
    difficulty_level: int = Field(default=1, ge=1, le=5)
    consecutive_strong_answers: int = 0
    consecutive_weak_answers: int = 0
    current_topic: str = ""
    topics_seen: List[str] = Field(default_factory=list)
    weak_areas: List[str] = Field(default_factory=list)
    follow_up_depth: int = 0
    question_count: int = 0
    interview_phase: InterviewPhase = InterviewPhase.WARMUP


class ImprovementPlan(BaseModel):
    immediate: List[str]
    short_term: List[str]
    resources: List[dict]  # [{topic: str, resource: str}]


class FinalReport(BaseModel):
    hiring_decision: HiringDecision
    level_assessment: str
    overall_scores: dict  # {technical, communication, problem_solving, adaptability, confidence}
    top_strengths: List[str]
    critical_gaps: List[str]
    improvement_plan: ImprovementPlan
    speech_summary: str


class InterviewSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    mode: InterviewMode
    target_role: TargetRole
    target_company: TargetCompany
    state: SessionState = Field(default_factory=SessionState)
    question_history: List[QuestionRecord] = Field(default_factory=list)
    final_report: Optional[FinalReport] = None
    started_at: datetime = Field(default_factory=datetime.utcnow)
    ended_at: Optional[datetime] = None
    duration_seconds: int = 0


# Interviewer Agent output contract
class InterviewerOutput(BaseModel):
    action: InterviewerAction
    question_text: str
    question_type: QuestionType
    follow_up_type: Optional[FollowUpType] = None
    internal_reasoning: str
