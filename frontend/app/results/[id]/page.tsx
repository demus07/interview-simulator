'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { ArrowLeft, CheckCircle, XCircle, AlertTriangle, TrendingUp } from 'lucide-react'
import { api, type FinalReport, type HiringDecision } from '@/lib/api'

const RadarChart = dynamic(() => import('@/components/RadarChart'), { ssr: false })

const DECISION_STYLE: Record<HiringDecision, { bg: string; border: string; text: string; label: string; glow: string }> = {
  'Strong Hire': {
    bg: 'bg-green-500/10', border: 'border-green-500/40',
    text: 'text-green-300',  glow: 'glow-green',
    label: 'Strong Hire',
  },
  'Hire': {
    bg: 'bg-teal-500/10', border: 'border-teal-400/40',
    text: 'text-teal-300', glow: 'glow-teal',
    label: 'Hire',
  },
  'No Hire': {
    bg: 'bg-amber-500/10', border: 'border-amber-400/40',
    text: 'text-amber-300', glow: 'glow-amber',
    label: 'No Hire',
  },
  'Strong No Hire': {
    bg: 'bg-red-500/10', border: 'border-red-500/40',
    text: 'text-red-300', glow: 'glow-red',
    label: 'Strong No Hire',
  },
}

const SCORE_LABELS: Record<string, string> = {
  technical: 'Technical',
  communication: 'Communication',
  problemSolving: 'Problem Solving',
  adaptability: 'Adaptability',
  confidence: 'Confidence',
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = (value / 10) * 100
  const color = value >= 8 ? 'bg-green-400' : value >= 6 ? 'bg-teal-400' : value >= 4 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-outfit text-xs text-slate-400">{label}</span>
        <span className="font-mono text-xs text-slate-300 tabular-nums">{value}/10</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export default function ResultsPage() {
  const { id: sessionId } = useParams<{ id: string }>()
  const router = useRouter()
  const [report, setReport] = useState<FinalReport | null>(null)
  const [polling, setPolling] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [dots,    setDots]    = useState('.')

  // Animate loading dots
  useEffect(() => {
    if (!polling) return
    const id = setInterval(() => setDots(d => d.length >= 3 ? '.' : d + '.'), 500)
    return () => clearInterval(id)
  }, [polling])

  // Poll for report
  useEffect(() => {
    let cancelled = false
    let attempts  = 0

    async function poll() {
      while (!cancelled && attempts < 60) {
        attempts++
        try {
          const data = await api.getReport(sessionId)
          if (data.ready && data.report) {
            if (!cancelled) { setReport(data.report); setPolling(false) }
            return
          }
        } catch (e) {
          if (attempts > 3) {
            setError('Could not load report. The session may have expired.')
            setPolling(false)
            return
          }
        }
        await new Promise(r => setTimeout(r, 2000))
      }
      if (!cancelled) {
        setError('Report generation timed out.')
        setPolling(false)
      }
    }

    poll()
    return () => { cancelled = true }
  }, [sessionId])

  if (polling || (!report && !error)) {
    return (
      <div className="min-h-screen bg-[#030712] grid-bg flex flex-col items-center justify-center gap-6">
        <div className="relative w-20 h-20">
          <span className="absolute inset-0 rounded-full border-2 border-teal-400/20 animate-spin-slow" style={{ borderTopColor: '#2dd4bf' }} />
          <span className="absolute inset-3 rounded-full border border-violet-400/20 animate-spin-slower" style={{ borderTopColor: '#a78bfa', animationDirection: 'reverse' }} />
        </div>
        <div className="text-center">
          <p className="font-syne font-bold text-white text-lg">Generating Report{dots}</p>
          <p className="font-mono text-[10px] text-slate-600 tracking-widest mt-1">Recruiter Agent is reviewing your performance</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#030712] grid-bg flex items-center justify-center">
        <div className="text-center space-y-4">
          <XCircle size={32} className="text-red-400 mx-auto" />
          <p className="font-mono text-sm text-red-400">{error}</p>
          <button onClick={() => router.push('/')} className="font-mono text-xs text-slate-600 hover:text-slate-400 underline">
            Start new session
          </button>
        </div>
      </div>
    )
  }

  const r = report!
  const ds = DECISION_STYLE[r.hiring_decision]

  return (
    <div className="min-h-screen bg-[#030712] grid-bg">

      {/* Ambient */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-[500px] h-[300px] rounded-full bg-teal-500/4 blur-3xl" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-6 py-10 space-y-8 animate-fade-up">

        {/* Back */}
        <button
          onClick={() => router.push('/')}
          className="flex items-center gap-2 font-mono text-[10px] tracking-widest text-slate-600 hover:text-slate-400 transition-colors uppercase"
        >
          <ArrowLeft size={12} /> New Session
        </button>

        {/* Verdict */}
        <div className={`rounded-2xl border p-8 text-center ${ds.bg} ${ds.border} ${ds.glow}`}>
          <p className="font-mono text-[10px] tracking-[0.3em] text-slate-500 uppercase mb-3">Hiring Decision</p>
          <h1 className={`font-syne text-5xl font-extrabold tracking-tight ${ds.text}`}>
            {r.hiring_decision}
          </h1>
          <p className="font-outfit text-slate-400 text-sm mt-4 max-w-xl mx-auto leading-relaxed">
            {r.level_assessment}
          </p>
        </div>

        {/* Scores row */}
        <div className="grid md:grid-cols-2 gap-6">

          {/* Radar chart */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
            <p className="font-mono text-[10px] tracking-widest text-slate-500 uppercase mb-4">Performance Radar</p>
            <RadarChart scores={r.overall_scores} />
          </div>

          {/* Score bars */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 space-y-5">
            <p className="font-mono text-[10px] tracking-widest text-slate-500 uppercase">Dimension Scores</p>
            {Object.entries(r.overall_scores).map(([k, v]) => (
              <ScoreBar key={k} label={SCORE_LABELS[k] ?? k} value={v} />
            ))}
          </div>
        </div>

        {/* Strengths + Gaps */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-green-500/15 bg-green-500/[0.03] p-6">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle size={14} className="text-green-400" />
              <p className="font-mono text-[10px] tracking-widest text-green-400/70 uppercase">Top Strengths</p>
            </div>
            <ul className="space-y-2.5">
              {r.top_strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-green-400/60 shrink-0" />
                  <span className="font-outfit text-sm text-slate-300 leading-snug">{s}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-red-500/15 bg-red-500/[0.03] p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={14} className="text-red-400" />
              <p className="font-mono text-[10px] tracking-widest text-red-400/70 uppercase">Critical Gaps</p>
            </div>
            <ul className="space-y-2.5">
              {r.critical_gaps.map((g, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-red-400/60 shrink-0" />
                  <span className="font-outfit text-sm text-slate-300 leading-snug">{g}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Improvement plan */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 space-y-6">
          <div className="flex items-center gap-2">
            <TrendingUp size={14} className="text-violet-400" />
            <p className="font-mono text-[10px] tracking-widest text-violet-400/70 uppercase">Improvement Plan</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <p className="font-mono text-[9px] tracking-widest text-slate-600 uppercase mb-3">This Week</p>
              <ul className="space-y-2">
                {r.improvement_plan.immediate.map((item, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-amber-400/60 shrink-0" />
                    <span className="font-outfit text-sm text-slate-300 leading-snug">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-mono text-[9px] tracking-widest text-slate-600 uppercase mb-3">1–2 Weeks</p>
              <ul className="space-y-2">
                {r.improvement_plan.short_term.map((item, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-violet-400/60 shrink-0" />
                    <span className="font-outfit text-sm text-slate-300 leading-snug">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {r.improvement_plan.resources.length > 0 && (
            <div>
              <p className="font-mono text-[9px] tracking-widest text-slate-600 uppercase mb-3">Resources</p>
              <div className="space-y-2">
                {r.improvement_plan.resources.map((res, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <span className="font-mono text-[10px] text-teal-400/70 mt-0.5 shrink-0 uppercase tracking-wider">
                      {res.topic}
                    </span>
                    <span className="font-outfit text-xs text-slate-400">{res.resource}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Speech summary */}
        {r.speech_summary && r.speech_summary !== 'Unavailable.' && (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
            <p className="font-mono text-[10px] tracking-widest text-slate-500 uppercase mb-3">Communication Analysis</p>
            <p className="font-outfit text-sm text-slate-400 leading-relaxed">{r.speech_summary}</p>
          </div>
        )}

        {/* CTA */}
        <div className="text-center pb-8">
          <button
            onClick={() => router.push('/')}
            className="px-8 py-3 rounded-xl border border-teal-400/30 bg-teal-400/8 text-teal-300 font-syne font-semibold text-sm tracking-wider hover:bg-teal-400/15 hover:border-teal-400/50 transition-all glow-teal"
          >
            Start Another Interview
          </button>
        </div>

      </div>
    </div>
  )
}
