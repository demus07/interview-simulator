const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1'

export type InterviewMode   = 'DSA' | 'SystemDesign' | 'Behavioral'
export type TargetRole      = 'SWE-L3' | 'SWE-L4' | 'SWE-L5' | 'EM' | 'PM'
export type TargetCompany   = 'Meta' | 'Google' | 'Amazon' | 'Apple' | 'Microsoft' | 'Generic'
export type InterviewPhase  = 'warmup' | 'core' | 'deep-dive' | 'stress-test' | 'closing'
export type HiringDecision  = 'Strong Hire' | 'Hire' | 'No Hire' | 'Strong No Hire'

export interface QuestionData {
  id: string
  question_text: string
  question_type: string
  follow_up_type: string | null
  difficulty_level: number
  topic?: string
}

export interface CreateSessionResponse {
  session_id: string
  question: QuestionData
  phase: InterviewPhase
  difficulty_level: number
}

export interface SubmitAnswerResponse {
  question: QuestionData | null
  is_complete: boolean
  phase: InterviewPhase
  difficulty_level: number
  question_count: number
}

export interface FinalReport {
  hiring_decision: HiringDecision
  level_assessment: string
  overall_scores: {
    technical: number
    communication: number
    problemSolving: number
    adaptability: number
    confidence: number
  }
  top_strengths: string[]
  critical_gaps: string[]
  improvement_plan: {
    immediate: string[]
    short_term: string[]
    resources: { topic: string; resource: string }[]
  }
  speech_summary: string
}

export interface ReportResponse {
  ready: boolean
  report: FinalReport | null
}

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  createSession: (body: {
    user_id: string
    mode: InterviewMode
    target_role: TargetRole
    target_company: TargetCompany
  }) => req<CreateSessionResponse>('/session', { method: 'POST', body: JSON.stringify(body) }),

  submitAnswer: (body: {
    session_id: string
    transcript: string
    duration_seconds: number
    speech_confidence?: number   // 0.0–1.0 from Web Speech API
    pause_count?: number         // detected pauses from Web Speech API
  }) => req<SubmitAnswerResponse>('/answer', { method: 'POST', body: JSON.stringify(body) }),

  getReport: (session_id: string) =>
    req<ReportResponse>(`/session/${session_id}/report`),

  endSession: (session_id: string) =>
    req<{ status: string }>(`/session/${session_id}/end`, { method: 'POST' }),
}
