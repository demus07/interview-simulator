'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, type InterviewMode, type TargetRole, type TargetCompany } from '@/lib/api'
import { Zap, AlertCircle } from 'lucide-react'

const MODES: { value: InterviewMode; label: string; tag: string; desc: string }[] = [
  { value: 'DSA',          label: 'Algorithms',    tag: 'DSA',    desc: 'Data structures, complexity, optimization' },
  { value: 'SystemDesign', label: 'System Design',  tag: 'SYS',   desc: 'Architecture, scale, trade-offs' },
  { value: 'Behavioral',  label: 'Behavioral',     tag: 'BEH',   desc: 'Leadership, STAR format, impact' },
]

const ROLES: TargetRole[] = ['SWE-L3', 'SWE-L4', 'SWE-L5', 'EM', 'PM']

const COMPANIES: { value: TargetCompany; color: string }[] = [
  { value: 'Meta',      color: 'text-blue-400' },
  { value: 'Google',    color: 'text-green-400' },
  { value: 'Amazon',    color: 'text-amber-400' },
  { value: 'Apple',     color: 'text-slate-300' },
  { value: 'Microsoft', color: 'text-sky-400' },
  { value: 'Generic',   color: 'text-slate-500' },
]

export default function SetupPage() {
  const router = useRouter()
  const [mode,    setMode]    = useState<InterviewMode>('DSA')
  const [role,    setRole]    = useState<TargetRole>('SWE-L4')
  const [company, setCompany] = useState<TargetCompany>('Google')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function start() {
    setLoading(true)
    setError(null)
    try {
      const result = await api.createSession({ user_id: 'test-user', mode, target_role: role, target_company: company })
      sessionStorage.setItem(
        `panel:${result.session_id}`,
        JSON.stringify({ question: result.question, phase: result.phase, difficulty_level: result.difficulty_level }),
      )
      router.push(`/interview/${result.session_id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start. Is the backend running?')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen grid-bg flex items-center justify-center p-6">

      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-teal-500/5 blur-3xl" />
        <div className="absolute bottom-0 right-0 w-80 h-80 bg-violet-500/5 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-2xl animate-fade-up">

        {/* Header */}
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 mb-5 px-3 py-1.5 rounded-full border border-teal-400/20 bg-teal-400/5">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
            <span className="font-mono text-[10px] tracking-[0.25em] text-teal-400 uppercase">System Ready</span>
          </div>
          <h1 className="font-syne text-5xl font-bold tracking-tight text-white mb-3">
            PANEL
          </h1>
          <p className="font-outfit text-slate-400 text-base">
            Adaptive AI interview simulation. Real questions. Honest feedback.
          </p>
        </div>

        {/* Config card */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm p-8 space-y-8">

          {/* Mode */}
          <div>
            <label className="block font-mono text-[10px] tracking-[0.2em] text-slate-500 uppercase mb-3">
              Interview Mode
            </label>
            <div className="grid grid-cols-3 gap-3">
              {MODES.map(m => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  className={`
                    group relative p-4 rounded-xl border text-left transition-all duration-200
                    ${mode === m.value
                      ? 'border-teal-400/50 bg-teal-400/8 glow-teal'
                      : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]'
                    }
                  `}
                >
                  <span className={`block font-mono text-[9px] tracking-widest mb-1.5 ${mode === m.value ? 'text-teal-400' : 'text-slate-600'}`}>
                    {m.tag}
                  </span>
                  <span className={`block font-syne text-sm font-semibold ${mode === m.value ? 'text-white' : 'text-slate-300'}`}>
                    {m.label}
                  </span>
                  <span className="block font-outfit text-[11px] text-slate-500 mt-1 leading-snug">
                    {m.desc}
                  </span>
                  {mode === m.value && (
                    <span className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-teal-400" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Role */}
          <div>
            <label className="block font-mono text-[10px] tracking-[0.2em] text-slate-500 uppercase mb-3">
              Target Level
            </label>
            <div className="flex gap-2 flex-wrap">
              {ROLES.map(r => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`
                    px-4 py-2 rounded-lg border font-mono text-xs tracking-wider transition-all duration-150
                    ${role === r
                      ? 'border-violet-400/50 bg-violet-400/10 text-violet-300'
                      : 'border-white/[0.06] text-slate-500 hover:border-white/[0.12] hover:text-slate-300'
                    }
                  `}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Company */}
          <div>
            <label className="block font-mono text-[10px] tracking-[0.2em] text-slate-500 uppercase mb-3">
              Target Company
            </label>
            <div className="flex gap-2 flex-wrap">
              {COMPANIES.map(c => (
                <button
                  key={c.value}
                  onClick={() => setCompany(c.value)}
                  className={`
                    px-4 py-2 rounded-lg border font-syne text-xs font-semibold tracking-wide transition-all duration-150
                    ${company === c.value
                      ? `border-white/20 bg-white/[0.06] ${c.color}`
                      : 'border-white/[0.06] text-slate-600 hover:border-white/[0.12] hover:text-slate-400'
                    }
                  `}
                >
                  {c.value}
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle size={15} className="text-red-400 mt-0.5 shrink-0" />
              <p className="font-mono text-xs text-red-400">{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={start}
            disabled={loading}
            className={`
              w-full py-4 rounded-xl font-syne font-bold text-sm tracking-[0.15em] uppercase
              transition-all duration-200 flex items-center justify-center gap-2
              ${loading
                ? 'bg-white/5 border border-white/[0.06] text-slate-600 cursor-not-allowed'
                : 'bg-teal-400/10 border border-teal-400/40 text-teal-300 hover:bg-teal-400/20 hover:border-teal-400/60 glow-teal'
              }
            `}
          >
            {loading ? (
              <>
                <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-600 border-t-teal-400 animate-spin" />
                Initializing Session…
              </>
            ) : (
              <>
                <Zap size={15} />
                Begin Interview
              </>
            )}
          </button>
        </div>

        <p className="text-center font-mono text-[10px] text-slate-600 mt-6 tracking-widest">
          {mode} · {role} · {company}
        </p>
      </div>
    </main>
  )
}
