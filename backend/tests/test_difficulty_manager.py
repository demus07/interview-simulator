"""
Unit tests for the Difficulty Manager pure function.
Covers every state transition defined in the architecture spec.
"""

import pytest

from app.agents.difficulty_manager import update_session_state
from app.models.types import (
    AnswerEvaluation,
    InterviewPhase,
    Score,
    SessionState,
)


# ─── Fixtures ─────────────────────────────────────────────────────────────────

NA = Score(value=-1, rationale="N/A")


def make_eval(technical: int, clarity: int) -> AnswerEvaluation:
    return AnswerEvaluation(
        technical_correctness=Score(value=technical, rationale="test"),
        explanation_clarity=Score(value=clarity, rationale="test"),
        structured_reasoning=Score(value=5, rationale="test"),
        edge_case_handling=Score(value=5, rationale="test"),
        time_complexity_awareness=NA,
        tradeoff_discussion=NA,
        star_structure=NA,
        strengths=[],
        gaps=[],
        missed_concepts=[],
        interviewer_internal_note="Test note.",
    )


STRONG = make_eval(technical=9, clarity=8)   # strong: ≥8 technical AND ≥7 clarity
AVERAGE = make_eval(technical=6, clarity=6)  # average: not strong, not weak
WEAK = make_eval(technical=4, clarity=5)     # weak: ≤4 technical


def base_state(**overrides) -> SessionState:
    return SessionState(**overrides)


# ─── Consecutive counter tests ────────────────────────────────────────────────

def test_strong_answer_increments_consecutive_strong():
    state = base_state()
    new = update_session_state(state, STRONG)
    assert new.consecutive_strong_answers == 1
    assert new.consecutive_weak_answers == 0


def test_weak_answer_increments_consecutive_weak():
    state = base_state()
    new = update_session_state(state, WEAK)
    assert new.consecutive_weak_answers == 1
    assert new.consecutive_strong_answers == 0


def test_average_answer_resets_both_counters():
    state = base_state(consecutive_strong_answers=1, consecutive_weak_answers=1)
    new = update_session_state(state, AVERAGE)
    assert new.consecutive_strong_answers == 0
    assert new.consecutive_weak_answers == 0


def test_strong_after_weak_resets_weak_counter():
    state = base_state(consecutive_weak_answers=1)
    new = update_session_state(state, STRONG)
    assert new.consecutive_weak_answers == 0
    assert new.consecutive_strong_answers == 1


# ─── Difficulty adjustment tests ──────────────────────────────────────────────

def test_two_strong_answers_increases_difficulty():
    state = base_state(difficulty_level=2, consecutive_strong_answers=1)
    new = update_session_state(state, STRONG)
    assert new.difficulty_level == 3
    assert new.consecutive_strong_answers == 0  # counter resets after trigger


def test_difficulty_does_not_exceed_5():
    state = base_state(difficulty_level=5, consecutive_strong_answers=1)
    new = update_session_state(state, STRONG)
    assert new.difficulty_level == 5


def test_two_weak_answers_decreases_difficulty():
    state = base_state(difficulty_level=3, consecutive_weak_answers=1)
    new = update_session_state(state, WEAK)
    assert new.difficulty_level == 2
    assert new.consecutive_weak_answers == 0


def test_difficulty_does_not_go_below_1():
    state = base_state(difficulty_level=1, consecutive_weak_answers=1)
    new = update_session_state(state, WEAK)
    assert new.difficulty_level == 1


# ─── Phase transition tests ───────────────────────────────────────────────────

def test_warmup_to_core_after_2_questions():
    state = base_state(interview_phase=InterviewPhase.WARMUP, question_count=1)
    new = update_session_state(state, AVERAGE)
    assert new.interview_phase == InterviewPhase.CORE


def test_warmup_stays_warmup_before_2_questions():
    state = base_state(interview_phase=InterviewPhase.WARMUP, question_count=0)
    new = update_session_state(state, AVERAGE)
    assert new.interview_phase == InterviewPhase.WARMUP


def test_core_to_deep_dive_on_strong_at_difficulty_3():
    state = base_state(interview_phase=InterviewPhase.CORE, difficulty_level=3)
    new = update_session_state(state, STRONG)
    assert new.interview_phase == InterviewPhase.DEEP_DIVE


def test_core_does_not_transition_on_strong_at_difficulty_2():
    state = base_state(interview_phase=InterviewPhase.CORE, difficulty_level=2)
    new = update_session_state(state, STRONG)
    assert new.interview_phase == InterviewPhase.CORE


def test_core_to_stress_test_on_repeated_weak_area():
    state = base_state(
        interview_phase=InterviewPhase.CORE,
        current_topic="binary trees",
        weak_areas=["binary trees"],  # already seen once
    )
    new = update_session_state(state, WEAK)
    assert new.interview_phase == InterviewPhase.STRESS_TEST


def test_deep_dive_to_stress_test_after_3_consecutive_strong():
    state = base_state(
        interview_phase=InterviewPhase.DEEP_DIVE,
        difficulty_level=4,
        consecutive_strong_answers=2,
    )
    new = update_session_state(state, STRONG)
    assert new.interview_phase == InterviewPhase.STRESS_TEST


def test_closing_after_8_questions():
    state = base_state(interview_phase=InterviewPhase.CORE, question_count=7)
    new = update_session_state(state, AVERAGE)
    assert new.interview_phase == InterviewPhase.CLOSING


def test_closing_after_duration_limit():
    state = base_state(interview_phase=InterviewPhase.CORE, question_count=3)
    new = update_session_state(state, AVERAGE, duration_seconds=2700)
    assert new.interview_phase == InterviewPhase.CLOSING


def test_closing_takes_priority_over_other_transitions():
    # Even if condition for deep-dive is met, closing wins
    state = base_state(
        interview_phase=InterviewPhase.CORE,
        difficulty_level=3,
        question_count=7,
    )
    new = update_session_state(state, STRONG)
    assert new.interview_phase == InterviewPhase.CLOSING


# ─── Weak area tracking ───────────────────────────────────────────────────────

def test_weak_area_appended_on_weak_answer():
    state = base_state(current_topic="dynamic programming")
    new = update_session_state(state, WEAK)
    assert "dynamic programming" in new.weak_areas


def test_weak_area_allows_duplicates_for_counting():
    state = base_state(current_topic="graphs", weak_areas=["graphs"])
    new = update_session_state(state, WEAK)
    assert new.weak_areas.count("graphs") == 2


def test_no_weak_area_added_on_strong_answer():
    state = base_state(current_topic="sorting")
    new = update_session_state(state, STRONG)
    assert "sorting" not in new.weak_areas


def test_question_count_increments():
    state = base_state(question_count=3)
    new = update_session_state(state, AVERAGE)
    assert new.question_count == 4


def test_original_state_is_not_mutated():
    state = base_state(difficulty_level=2, question_count=3)
    _ = update_session_state(state, STRONG)
    assert state.difficulty_level == 2
    assert state.question_count == 3
