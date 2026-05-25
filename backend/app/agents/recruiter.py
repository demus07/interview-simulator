"""
Recruiter Agent — GPT-4o.

Temperature: 0.3
Runs once at session end. Produces FinalReport.
"""

from __future__ import annotations

import json
import re

import openai
from pydantic import ValidationError

from app.agents.prompts import build_recruiter_prompt
from app.config import settings
from app.models.types import (
    FinalReport,
    HiringDecision,
    ImprovementPlan,
    InterviewMode,
    QuestionRecord,
    SpeechMetrics,
    TargetCompany,
    TargetRole,
)

_openai_client: openai.AsyncOpenAI | None = None


def _get_openai() -> openai.AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    return _openai_client


def _extract_json(text: str) -> str:
    text = text.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    if match:
        return match.group(1)
    return text


def _parse_report(raw: str) -> FinalReport:
    data = json.loads(_extract_json(raw))
    plan_data = data.get("improvementPlan", {})
    return FinalReport(
        hiring_decision=HiringDecision(data["hiringDecision"]),
        level_assessment=data["levelAssessment"],
        overall_scores=data["overallScores"],
        top_strengths=data.get("topStrengths", []),
        critical_gaps=data.get("criticalGaps", []),
        improvement_plan=ImprovementPlan(
            immediate=plan_data.get("immediate", []),
            short_term=plan_data.get("shortTerm", []),
            resources=plan_data.get("resources", []),
        ),
        speech_summary=data.get("speechSummary", ""),
    )


async def run_recruiter_agent(
    target_role: TargetRole,
    target_company: TargetCompany,
    mode: InterviewMode,
    duration_seconds: int,
    question_history: list[QuestionRecord],
    weak_areas: list[str],
    max_difficulty_reached: int,
    max_retries: int = 2,
) -> FinalReport:
    evaluations = []
    speech_metrics: list[SpeechMetrics] = []

    for qr in question_history:
        if qr.evaluation:
            evaluations.append(qr.evaluation.model_dump())
        if qr.user_answer:
            speech_metrics.append(qr.user_answer.speech_metrics)

    prompt = build_recruiter_prompt(
        target_role=target_role,
        target_company=target_company,
        mode=mode,
        duration_seconds=duration_seconds,
        question_count=len(question_history),
        evaluations=evaluations,
        speech_metrics=speech_metrics,
        weak_areas=weak_areas,
        max_difficulty_reached=max_difficulty_reached,
    )

    client = _get_openai()
    last_err: Exception | None = None

    for attempt in range(max_retries + 1):
        try:
            response = await client.chat.completions.create(
                model=settings.recruiter_model,
                max_tokens=2048,
                temperature=0.3,
                response_format={"type": "json_object"},
                messages=[
                    {
                        "role": "system",
                        "content": "You are a senior engineering recruiter. Always respond with valid JSON.",
                    },
                    {"role": "user", "content": prompt},
                ],
            )
            raw = response.choices[0].message.content or "{}"
            return _parse_report(raw)
        except (json.JSONDecodeError, ValidationError, KeyError, ValueError) as exc:
            last_err = exc
            prompt += f"\n\nPrevious response failed validation. Error: {exc}\nRespond with valid JSON only."

    # Minimal fallback so session always completes
    return FinalReport(
        hiring_decision=HiringDecision.NO_HIRE,
        level_assessment="Report generation failed — please retry.",
        overall_scores={"technical": 0, "communication": 0, "problemSolving": 0, "adaptability": 0, "confidence": 0},
        top_strengths=[],
        critical_gaps=[f"Report generation error: {last_err}"],
        improvement_plan=ImprovementPlan(immediate=[], short_term=[], resources=[]),
        speech_summary="Unavailable.",
    )
