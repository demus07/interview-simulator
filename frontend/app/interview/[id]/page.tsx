'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Send, Clock } from 'lucide-react'
import InterviewerAvatar, { type AvatarState } from '@/components/InterviewerAvatar'
import { api, type InterviewPhase, type QuestionData } from '@/lib/api'

interface TranscriptEntry { question: QuestionData; answer: string }

const PHASE_COLOR: Record<InterviewPhase, string> = {
  warmup:       'text-slate-400 border-slate-600/40 bg-slate-800/40',
  core:         'text-teal-400  border-teal-600/40  bg-teal-900/20',
  'deep-dive':  'text-violet-400 border-violet-600/40 bg-violet-900/20',
  'stress-test':'text-amber-400  border-amber-600/40  bg-amber-900/20',
  closing:      'text-slate-400  border-slate-600/40  bg-slate-800/40',
}

function DifficultyDots({ level }: { level: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1,2,3,4,5].map(i => (
        <span
          key={i}
          className={`w-1.5 h-1.5 rounded-full transition-all duration-500 ${
            i <= level ? 'bg-amber-400' : 'bg-slate-700'
          }`}
        />
      ))}
    </div>
  )
}

function ElapsedTimer({ startedAt }: { startedAt: Date }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000)), 1000)
    return () => clearInterval(id)
  }, [startedAt])
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const s = String(elapsed % 60).padStart(2, '0')
  return <span className="font-mono text-xs text-slate-500 tabular-nums">{m}:{s}</span>
}

export default function InterviewPage() {
  const { id: sessionId } = useParams<{ id: string }>()
  const router = useRouter()

  const [question,      setQuestion]      = useState<QuestionData | null>(null)
  const [phase,         setPhase]         = useState<InterviewPhase>('warmup')
  const [difficulty,    setDifficulty]    = useState(1)
  const [questionCount, setQuestionCount] = useState(0)
  const [avatarState,   setAvatarState]   = useState<AvatarState>('questioning')
  const [answer,        setAnswer]        = useState('')
  const [submitting,    setSubmitting]    = useState(false)
  const [transcript,    setTranscript]    = useState<TranscriptEntry[]>([])
  const [showTranscript,setShowTranscript]= useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [startedAt]                       = useState(() => new Date())
  const answerStartRef                    = useRef<Date>(new Date())
  const textareaRef                       = useRef<HTMLTextAreaElement>(null)
  const transcriptEndRef                  = useRef<HTMLDivElement>(null)

  // Load first question from sessionStorage
  useEffect(() => {
    const stored = sessionStorage.getItem(`panel:${sessionId}`)
    if (!stored) { router.push('/'); return }
    const { question: q, phase: p, difficulty_level: d } = JSON.parse(stored)
    sessionStorage.removeItem(`panel:${sessionId}`)
    setQuestion(q)
    setPhase(p)
    setDifficulty(d)
    setAvatarState('questioning')
    answerStartRef.current = new Date()
    // Auto-switch to listening after the question is "spoken"
    const t = setTimeout(() => setAvatarState('listening'), 3000)
    return () => clearTimeout(t)
  }, [sessionId, router])

  // Focus textarea when listening
  useEffect(() => {
    if (avatarState === 'listening') textareaRef.current?.focus()
  }, [avatarState])

  // Scroll transcript to bottom
  useEffect(() => {
    if (showTranscript) transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript, showTranscript])

  const handleSubmit = useCallback(async () => {
    if (!answer.trim() || !question || submitting) return
    setSubmitting(true)
    setAvatarState('thinking')
    setError(null)

    const duration = (Date.now() - answerStartRef.current.getTime()) / 1000

    try {
      const result = await api.submitAnswer({
        session_id: sessionId,
        transcript: answer.trim(),
        duration_seconds: Math.max(1, duration),
      })

      // Add to transcript
      setTranscript(prev => [...prev, { question, answer: answer.trim() }])
      setAnswer('')

      if (result.is_complete || !result.question) {
        // Session complete — go to results
        router.push(`/results/${sessionId}`)
        return
      }

      setQuestion(result.question)
      setPhase(result.phase)
      setDifficulty(result.difficulty_level)
      setQuestionCount(result.question_count)
      setAvatarState('questioning')
      answerStartRef.current = new Date()
      setTimeout(() => {
        setAvatarState('listening')
        textareaRef.current?.focus()
      }, 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed. Try again.')
      setAvatarState('listening')
    } finally {
      setSubmitting(false)
    }
  }, [answer, question, submitting, sessionId, router])

  // Cmd/Ctrl+Enter to submit
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleSubmit])

  if (!question) {
    return (
      <div className="min-h-screen bg-[#030712] grid-bg flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-500">
          <span className="w-4 h-4 rounded-full border-2 border-slate-700 border-t-teal-400 animate-spin" />
          <span className="font-mono text-xs tracking-widest">LOADING SESSION…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#030712] grid-bg flex flex-col">

      {/* ── Top bar ───────────────────────────────────────── */}
      <header className="shrink-0 flex items-center justify-between px-6 py-3 border-b border-white/[0.04] bg-black/20 backdrop-blur-sm">
        <span className="font-syne font-bold text-sm tracking-[0.15em] text-white/80">PANEL</span>
        <div className="flex items-center gap-4">
          <span className={`px-2.5 py-1 rounded-md border font-mono text-[9px] tracking-widest uppercase ${PHASE_COLOR[phase]}`}>
            {phase}
          </span>
          <DifficultyDots level={difficulty} />
          <span className="font-mono text-[10px] text-slate-600 tabular-nums">
            Q{questionCount + 1}
          </span>
          <div className="flex items-center gap-1.5 text-slate-500">
            <Clock size={11} />
            <ElapsedTimer startedAt={startedAt} />
          </div>
        </div>
      </header>

      {/* ── Main ─────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left — interviewer */}
        <div className="hidden md:flex w-56 shrink-0 flex-col items-center justify-center gap-8 px-6 border-r border-white/[0.04]">
          <InterviewerAvatar state={avatarState} />

          {/* Decorative separator */}
          <div className="w-px h-16 bg-gradient-to-b from-transparent via-white/[0.06] to-transparent" />

          {/* Mini transcript count */}
          <div className="text-center">
            <p className="font-mono text-[9px] tracking-widest text-slate-600 uppercase">Exchanges</p>
            <p className="font-syne text-2xl font-bold text-slate-400 mt-0.5">{transcript.length}</p>
          </div>
        </div>

        {/* Right — conversation */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Mobile avatar strip */}
          <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
            <InterviewerAvatar state={avatarState} />
            <DifficultyDots level={difficulty} />
          </div>

          {/* Question + answer area */}
          <div className="flex-1 flex flex-col overflow-y-auto px-6 py-6 gap-6">

            {/* Question card */}
            <div
              key={question.id}
              className="animate-fade-up rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6"
            >
              <div className="flex items-center gap-2 mb-4">
                <span className="font-mono text-[9px] tracking-widest text-teal-400/70 uppercase">
                  {question.question_type}
                  {question.follow_up_type ? ` · ${question.follow_up_type.replace('_', ' ')}` : ''}
                </span>
                <span className="ml-auto font-mono text-[9px] text-slate-700">
                  {['·','··','···','····','·····'].slice(0, difficulty).join('') + ['','','','',''].slice(difficulty, 5).join('·')}
                </span>
              </div>
              <p className="font-mono text-slate-100 text-[15px] leading-relaxed">
                {question.question_text}
              </p>
            </div>

            {/* Answer input */}
            <div className="animate-fade-up" style={{ animationDelay: '0.1s' }}>
              <textarea
                ref={textareaRef}
                value={answer}
                onChange={e => setAnswer(e.target.value)}
                disabled={submitting}
                placeholder={
                  avatarState === 'thinking'
                    ? 'Processing your answer…'
                    : 'Type your answer here… (⌘↵ to submit)'
                }
                className="
                  w-full min-h-[180px] resize-none rounded-2xl
                  border border-white/[0.06] bg-white/[0.02]
                  px-5 py-4 font-mono text-sm text-slate-200 placeholder-slate-700
                  focus:outline-none focus:border-teal-400/30 focus:bg-teal-400/[0.02]
                  transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed
                "
              />
              <div className="flex items-center justify-between mt-3">
                <span className="font-mono text-[10px] text-slate-700">
                  {answer.length > 0 ? `${answer.split(/\s+/).filter(Boolean).length} words` : ''}
                </span>
                {error && (
                  <span className="font-mono text-[10px] text-red-400">{error}</span>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={!answer.trim() || submitting}
                  className="
                    flex items-center gap-2 px-5 py-2.5 rounded-xl
                    font-syne font-semibold text-xs tracking-wider uppercase
                    border transition-all duration-150
                    disabled:opacity-30 disabled:cursor-not-allowed
                    border-teal-400/40 bg-teal-400/8 text-teal-300
                    hover:bg-teal-400/15 hover:border-teal-400/60 enabled:glow-teal
                  "
                >
                  {submitting ? (
                    <span className="w-3 h-3 rounded-full border border-teal-400/40 border-t-teal-400 animate-spin" />
                  ) : (
                    <Send size={13} />
                  )}
                  {submitting ? 'Evaluating…' : 'Submit'}
                </button>
              </div>
            </div>
          </div>

          {/* ── Transcript drawer ─────────────────────── */}
          {transcript.length > 0 && (
            <div className="shrink-0 border-t border-white/[0.04]">
              <button
                onClick={() => setShowTranscript(v => !v)}
                className="w-full flex items-center justify-between px-6 py-3 text-slate-600 hover:text-slate-400 transition-colors"
              >
                <span className="font-mono text-[10px] tracking-widest uppercase">
                  Previous exchanges ({transcript.length})
                </span>
                {showTranscript ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              </button>

              {showTranscript && (
                <div className="max-h-72 overflow-y-auto px-6 pb-4 space-y-4">
                  {transcript.map((entry, i) => (
                    <div key={i} className="animate-slide-in space-y-2">
                      <div className="flex items-start gap-3">
                        <span className="mt-1 shrink-0 w-4 h-4 rounded-full border border-teal-400/30 flex items-center justify-center">
                          <span className="text-[7px] font-mono text-teal-400">Q</span>
                        </span>
                        <p className="font-mono text-xs text-slate-400 leading-relaxed">
                          {entry.question.question_text}
                        </p>
                      </div>
                      <div className="flex items-start gap-3 pl-1">
                        <span className="mt-1 shrink-0 w-4 h-4 rounded-full border border-violet-400/30 flex items-center justify-center">
                          <span className="text-[7px] font-mono text-violet-400">A</span>
                        </span>
                        <p className="font-mono text-xs text-slate-600 leading-relaxed">
                          {entry.answer.length > 200 ? entry.answer.slice(0, 200) + '…' : entry.answer}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={transcriptEndRef} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
