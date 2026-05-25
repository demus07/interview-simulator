"""
Interviewer Agent — calls Claude (default) or GPT-4o.

Temperature: 0.7
Runs every turn after the Evaluator finishes.
Output is validated against InterviewerOutput before returning.
"""

from __future__ import annotations

import json
import re
from typing import List

import anthropic
import openai
from pydantic import ValidationError

from app.agents.prompts import build_interviewer_prompt
from app.config import settings
from app.models.types import (
    AnswerEvaluation,
    InterviewerAction,
    InterviewerOutput,
    InterviewPhase,
    QuestionRecord,
    QuestionType,
    SessionState,
    TargetCompany,
    TargetRole,
)

_anthropic_client: anthropic.AsyncAnthropic | None = None
_openai_client: openai.AsyncOpenAI | None = None


def _get_anthropic() -> anthropic.AsyncAnthropic:
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _anthropic_client


def _get_openai() -> openai.AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    return _openai_client


def _extract_json(text: str) -> str:
    """Strip markdown fences and leading/trailing whitespace."""
    text = text.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    if match:
        return match.group(1)
    return text


def _parse_output(raw: str, state: SessionState) -> InterviewerOutput:
    data = json.loads(_extract_json(raw))

    # Normalise camelCase keys from the prompt to Python snake_case
    action_raw = data.get("action", "new_question")
    question_text = data.get("questionText", "")
    question_type_raw = data.get("questionType", "opening")
    follow_up_type_raw = data.get("followUpType")
    internal_reasoning = data.get("internalReasoning", "")

    # Server-side enforcement: followUpDepth cap
    if state.follow_up_depth >= 3 and action_raw == "follow_up":
        action_raw = "new_question"
        question_type_raw = "opening"
        follow_up_type_raw = None

    # Map to closing if state says so
    if state.interview_phase == InterviewPhase.CLOSING and action_raw not in ("close",):
        action_raw = "close"

    return InterviewerOutput(
        action=InterviewerAction(action_raw),
        question_text=question_text,
        question_type=QuestionType(question_type_raw),
        follow_up_type=follow_up_type_raw,
        internal_reasoning=internal_reasoning,
    )


async def _call_claude(prompt: str) -> str:
    client = _get_anthropic()
    message = await client.messages.create(
        model=settings.interviewer_model,
        max_tokens=512,
        temperature=0.7,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text


async def _call_openai(prompt: str) -> str:
    client = _get_openai()
    response = await client.chat.completions.create(
        model=settings.interviewer_model,
        max_tokens=512,
        temperature=0.7,
        messages=[
            {"role": "system", "content": "You are a technical interviewer."},
            {"role": "user", "content": prompt},
        ],
    )
    return response.choices[0].message.content or ""


async def run_interviewer_agent(
    state: SessionState,
    last_evaluation: AnswerEvaluation | None,
    recent_questions: List[QuestionRecord],
    target_role: TargetRole,
    target_company: TargetCompany,
    max_retries: int = 2,
) -> InterviewerOutput:
    """
    Assemble the prompt, call the LLM, validate output.
    Retries up to max_retries on JSON parse or validation errors.
    """
    prompt = build_interviewer_prompt(
        state, last_evaluation, recent_questions, target_role, target_company
    )

    is_claude = settings.interviewer_model.startswith("claude")
    last_err: Exception | None = None

    for attempt in range(max_retries + 1):
        try:
            raw = await (_call_claude(prompt) if is_claude else _call_openai(prompt))
            return _parse_output(raw, state)
        except (json.JSONDecodeError, ValidationError, KeyError, ValueError) as exc:
            last_err = exc
            # On retry, append the error to nudge the model
            prompt += f"\n\nYour previous response was invalid JSON. Error: {exc}\nPlease respond with valid JSON only."

    # Fallback: safe default question so the session never gets stuck
    return InterviewerOutput(
        action=InterviewerAction.NEW_QUESTION,
        question_text="Let's move on. Can you walk me through how you approach debugging a production issue?",
        question_type=QuestionType.OPENING,
        follow_up_type=None,
        internal_reasoning=f"Fallback after {max_retries + 1} failed LLM attempts: {last_err}",
    )
