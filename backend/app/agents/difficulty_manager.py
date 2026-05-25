"""
Difficulty Manager — pure function, no LLM calls.

Implements all state machine transitions defined in the architecture spec.
"""

from __future__ import annotations

from collections import Counter

from app.models.types import AnswerEvaluation, InterviewPhase, SessionState


def _is_strong(ev: AnswerEvaluation) -> bool:
    return (
        ev.technical_correctness.value >= 8
        and ev.explanation_clarity.value >= 7
    )


def _is_weak(ev: AnswerEvaluation) -> bool:
    return ev.technical_correctness.value <= 4


def update_session_state(
    state: SessionState,
    evaluation: AnswerEvaluation,
    duration_seconds: int = 0,
) -> SessionState:
    """
    Return a new SessionState after processing one completed answer.

    Args:
        state: Current session state (treated as immutable).
        evaluation: Evaluator output for the answer just given.
        duration_seconds: Total elapsed session time (used for closing transition).
    """
    s = state.model_copy(deep=True)

    strong = _is_strong(evaluation)
    weak = _is_weak(evaluation)

    # ── Consecutive counters ──────────────────────────────────────────────────
    if strong:
        s.consecutive_strong_answers += 1
        s.consecutive_weak_answers = 0
    elif weak:
        s.consecutive_weak_answers += 1
        s.consecutive_strong_answers = 0
    else:
        # Average answer resets both streaks
        s.consecutive_strong_answers = 0
        s.consecutive_weak_answers = 0

    # ── Track weak areas (duplicates allowed — used to detect repeated weakness) ─
    if weak and s.current_topic:
        s.weak_areas.append(s.current_topic)

    # Snapshot consecutive counts before difficulty adjustment resets them.
    # Phase transitions reference these pre-reset values.
    pre_reset_consecutive_strong = s.consecutive_strong_answers
    pre_reset_consecutive_weak = s.consecutive_weak_answers

    # ── Difficulty adjustment ─────────────────────────────────────────────────
    if s.consecutive_strong_answers >= 2:
        s.difficulty_level = min(5, s.difficulty_level + 1)
        s.consecutive_strong_answers = 0
    elif s.consecutive_weak_answers >= 2:
        s.difficulty_level = max(1, s.difficulty_level - 1)
        s.consecutive_weak_answers = 0

    # ── Increment question count ──────────────────────────────────────────────
    s.question_count += 1

    # ── Phase transitions (closing checked first — always takes priority) ─────
    if s.question_count >= 8 or duration_seconds >= 2700:
        s.interview_phase = InterviewPhase.CLOSING
        return s

    if state.interview_phase == InterviewPhase.WARMUP:
        if s.question_count >= 2:
            s.interview_phase = InterviewPhase.CORE

    elif state.interview_phase == InterviewPhase.CORE:
        # Repeated weakness in the same topic → stress-test
        weak_counts = Counter(s.weak_areas)
        if any(count >= 2 for count in weak_counts.values()):
            s.interview_phase = InterviewPhase.STRESS_TEST
        # Strong answer at difficulty ≥ 3 → deep-dive
        elif strong and state.difficulty_level >= 3:
            s.interview_phase = InterviewPhase.DEEP_DIVE

    elif state.interview_phase == InterviewPhase.DEEP_DIVE:
        if pre_reset_consecutive_strong >= 3:
            s.interview_phase = InterviewPhase.STRESS_TEST

    return s
