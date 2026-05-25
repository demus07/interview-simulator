"""
Evaluator Agent — GPT-4o-mini (default) or Claude.

Temperature: 0.1
Runs in parallel with the Interviewer Agent (non-blocking).
Output is validated against AnswerEvaluation before returning.
"""

from __future__ import annotations

import json
import re

import anthropic
import openai
from pydantic import ValidationError

from app.agents.prompts import build_evaluator_prompt
from app.config import settings
from app.models.types import (
    AnswerEvaluation,
    InterviewMode,
    Score,
    TargetCompany,
    TargetRole,
)

_openai_client: openai.AsyncOpenAI | None = None
_anthropic_client: anthropic.AsyncAnthropic | None = None


def _get_openai() -> openai.AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    return _openai_client


def _get_anthropic() -> anthropic.AsyncAnthropic:
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _anthropic_client


def _extract_json(text: str) -> str:
    text = text.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    if match:
        return match.group(1)
    return text


def _parse_evaluation(raw: str) -> AnswerEvaluation:
    data = json.loads(_extract_json(raw))

    def score(key: str) -> Score:
        raw_score = data.get(key, {"value": -1, "rationale": "N/A"})
        return Score(value=raw_score["value"], rationale=raw_score["rationale"])

    return AnswerEvaluation(
        technical_correctness=score("technicalCorrectness"),
        explanation_clarity=score("explanationClarity"),
        structured_reasoning=score("structuredReasoning"),
        edge_case_handling=score("edgeCaseHandling"),
        time_complexity_awareness=score("timeComplexityAwareness"),
        tradeoff_discussion=score("tradeoffDiscussion"),
        star_structure=score("starStructure"),
        strengths=data.get("strengths", []),
        gaps=data.get("gaps", []),
        missed_concepts=data.get("missedConcepts", []),
        interviewer_internal_note=data.get("interviewerInternalNote", "No note provided."),
    )


async def _call_openai(prompt: str) -> str:
    client = _get_openai()
    response = await client.chat.completions.create(
        model=settings.evaluator_model,
        max_tokens=1024,
        temperature=0.1,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": "You are a calibrated technical interview evaluator. Always respond with valid JSON.",
            },
            {"role": "user", "content": prompt},
        ],
    )
    return response.choices[0].message.content or "{}"


async def _call_claude(prompt: str) -> str:
    client = _get_anthropic()
    message = await client.messages.create(
        model=settings.evaluator_model,
        max_tokens=1024,
        temperature=0.1,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text


def _fallback_evaluation(reason: str) -> AnswerEvaluation:
    """Return a neutral evaluation when the LLM fails repeatedly."""
    na = Score(value=-1, rationale="Evaluation unavailable.")
    mid = Score(value=5, rationale="Could not evaluate — using neutral placeholder.")
    return AnswerEvaluation(
        technical_correctness=mid,
        explanation_clarity=mid,
        structured_reasoning=mid,
        edge_case_handling=mid,
        time_complexity_awareness=na,
        tradeoff_discussion=na,
        star_structure=na,
        strengths=[],
        gaps=[],
        missed_concepts=[],
        interviewer_internal_note=f"Evaluation failed: {reason}",
    )


async def run_evaluator_agent(
    mode: InterviewMode,
    target_role: TargetRole,
    target_company: TargetCompany,
    question_text: str,
    question_type: str,
    transcript: str,
    max_retries: int = 2,
) -> AnswerEvaluation:
    """
    Call the Evaluator LLM, validate output against AnswerEvaluation schema.
    Designed to run concurrently alongside the Interviewer Agent.
    """
    prompt = build_evaluator_prompt(
        mode, target_role, target_company, question_text, question_type, transcript
    )

    is_claude = settings.evaluator_model.startswith("claude")
    last_err: Exception | None = None

    for attempt in range(max_retries + 1):
        try:
            raw = await (_call_claude(prompt) if is_claude else _call_openai(prompt))
            evaluation = _parse_evaluation(raw)
            # Validate that the internal note is non-empty (required by spec)
            if not evaluation.interviewer_internal_note.strip():
                raise ValueError("interviewerInternalNote is empty")
            return evaluation
        except (json.JSONDecodeError, ValidationError, KeyError, ValueError) as exc:
            last_err = exc
            prompt += f"\n\nPrevious response failed validation. Error: {exc}\nRespond with valid JSON only."

    return _fallback_evaluation(str(last_err))
