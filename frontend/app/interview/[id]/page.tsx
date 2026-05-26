'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Clock, Mic, RotateCcw, Send, Square } from 'lucide-react'
import InterviewerAvatar, { type AvatarState } from '@/components/InterviewerAvatar'
import { api, type InterviewPhase, type QuestionData } from '@/lib/api'

interface TranscriptEntry { question: QuestionData; answer: string }
type VoiceState = 'idle' | 'recording' | 'reviewing'

// Module-level cache survives React Strict Mode's double-mount.
// sessionStorage is cleared after first read, so the second invocation
// reads from here instead of redirecting to /.
type SessionSeed = { question: QuestionData; phase: InterviewPhase; difficulty_level: number }
const _seedCache = new Map<string, SessionSeed>()

const PHASE_COLOR: Record<InterviewPhase, string> = {
  warmup:       'text-slate-400 border-slate-600/40 bg-slate-800/40',
  core:         'text-teal-400  border-teal-600/40  bg-teal-900/20',
  'deep-dive':  'text-violet-400 border-violet-600/40 bg-violet-900/20',
  'stress-test':'text-amber-400  border-amber-600/40  bg-amber-900/20',
  closing:      'text-slate-400  border-slate-600/40  bg-slate-800/40',
}

// Fixed heights to avoid hydration mismatch from Math.random()
const BAR_HEIGHTS = [8, 14, 20, 16, 10, 18, 12, 22, 8, 16, 12, 18]

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

function Waveform() {
  return (
    <div className="flex items-end gap-0.5 h-6">
      {BAR_HEIGHTS.map((h, i) => (
        <span
          key={i}
          className="w-0.5 rounded-full bg-teal-400/70"
          style={{
            height: `${h}px`,
            animation: `pulse ${0.6 + (i % 4) * 0.15}s ease-in-out infinite alternate`,
            animationDelay: `${i * 0.07}s`,
          }}
        />
      ))}
    </div>
  )
}

export default function InterviewPage() {
  const { id: sessionId } = useParams<{ id: string }>()
  const router = useRouter()

  const [question,       setQuestion]       = useState<QuestionData | null>(null)
  const [phase,          setPhase]          = useState<InterviewPhase>('warmup')
  const [difficulty,     setDifficulty]     = useState(1)
  const [questionCount,  setQuestionCount]  = useState(0)
  const [avatarState,    setAvatarState]    = useState<AvatarState>('questioning')
  const [submitting,     setSubmitting]     = useState(false)
  const [transcript,     setTranscript]     = useState<TranscriptEntry[]>([])
  const [showTranscript, setShowTranscript] = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [startedAt]                         = useState(() => new Date())

  // Voice state
  const [hasSpeechAPI,    setHasSpeechAPI]    = useState(false)
  const [voiceState,      setVoiceState]      = useState<VoiceState>('idle')
  const [liveTranscript,  setLiveTranscript]  = useState('')
  const [finalTranscript, setFinalTranscript] = useState('')

  // Fallback text mode for browsers without Speech API (e.g. Firefox)
  const [textAnswer,     setTextAnswer]     = useState('')
  const textareaRef                         = useRef<HTMLTextAreaElement>(null)

  // Refs for voice recording (mutable, no re-render needed)
  const recognitionRef  = useRef<SpeechRecognition | null>(null)
  const isRecordingRef  = useRef(false)
  const accumulatedRef  = useRef('')
  const confidenceRef   = useRef({ sum: 0, count: 0 })
  const pauseCountRef   = useRef(0)

  const answerStartRef   = useRef<Date>(new Date())
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  // Detect Speech API support on client (safe for SSR)
  useEffect(() => {
    setHasSpeechAPI(!!(window.SpeechRecognition || window.webkitSpeechRecognition))
  }, [])

  // Load first question — checks module cache first (survives React Strict Mode double-mount),
  // then falls back to sessionStorage (cleared after first read).
  useEffect(() => {
    let seed = _seedCache.get(sessionId)
    if (!seed) {
      const raw = sessionStorage.getItem(`panel:${sessionId}`)
      if (!raw) { router.push('/'); return }
      seed = JSON.parse(raw) as SessionSeed
      _seedCache.set(sessionId, seed)
      sessionStorage.removeItem(`panel:${sessionId}`)
    }
    const { question: q, phase: p, difficulty_level: d } = seed
    setQuestion(q)
    setPhase(p)
    setDifficulty(d)
    setAvatarState('questioning')
    answerStartRef.current = new Date()
    const t = setTimeout(() => setAvatarState('listening'), 2500)
    return () => clearTimeout(t)
  }, [sessionId, router])

  // Focus textarea in text-fallback mode
  useEffect(() => {
    if (!hasSpeechAPI && avatarState === 'listening') textareaRef.current?.focus()
  }, [avatarState, hasSpeechAPI])

  // Scroll transcript drawer to bottom
  useEffect(() => {
    if (showTranscript) transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript, showTranscript])

  // Stop recognition on unmount
  useEffect(() => {
    return () => {
      isRecordingRef.current = false
      recognitionRef.current?.abort()
    }
  }, [])

  const startRecording = useCallback(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognitionAPI) return

    accumulatedRef.current = ''
    confidenceRef.current = { sum: 0, count: 0 }
    pauseCountRef.current = 0
    isRecordingRef.current = true
    setLiveTranscript('')
    setError(null)
    answerStartRef.current = new Date()

    // Inner factory used to restart after browser auto-stops on silence
    const createAndStart = (): SpeechRecognition => {
      const rec = new SpeechRecognitionAPI()
      rec.continuous = true
      rec.interimResults = true
      rec.lang = 'en-US'

      rec.onresult = (event: SpeechRecognitionEvent) => {
        let interim = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          if (result.isFinal) {
            accumulatedRef.current += result[0].transcript + ' '
            confidenceRef.current.sum += result[0].confidence
            confidenceRef.current.count++
          } else {
            interim += result[0].transcript
          }
        }
        setLiveTranscript(accumulatedRef.current + interim)
      }

      rec.onspeechend = () => {
        pauseCountRef.current++
      }

      // Browser auto-stopped (e.g. silence timeout) — restart if still in recording mode
      rec.onend = () => {
        if (isRecordingRef.current) {
          try {
            const next = createAndStart()
            recognitionRef.current = next
          } catch {
            isRecordingRef.current = false
            setFinalTranscript(accumulatedRef.current.trim())
            setVoiceState('reviewing')
          }
        }
      }

      rec.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'not-allowed') {
          setError('Microphone access denied. Allow microphone access and try again.')
          isRecordingRef.current = false
          setVoiceState('idle')
        }
        // 'no-speech' and network errors are handled by onend → restart
      }

      rec.start()
      return rec
    }

    recognitionRef.current = createAndStart()
    setVoiceState('recording')
  }, [])

  const stopRecording = useCallback(() => {
    isRecordingRef.current = false  // Prevents onend from restarting
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setFinalTranscript(accumulatedRef.current.trim())
    setLiveTranscript('')
    setVoiceState('reviewing')
  }, [])

  const handleSubmit = useCallback(async () => {
    const answerText = hasSpeechAPI ? finalTranscript.trim() : textAnswer.trim()
    if (!answerText || !question || submitting) return

    setSubmitting(true)
    setAvatarState('thinking')
    setError(null)

    const duration = (Date.now() - answerStartRef.current.getTime()) / 1000
    const conf = confidenceRef.current

    try {
      const result = await api.submitAnswer({
        session_id: sessionId,
        transcript: answerText,
        duration_seconds: Math.max(1, duration),
        // Pass real voice metrics when available
        speech_confidence: hasSpeechAPI && conf.count > 0 ? conf.sum / conf.count : undefined,
        pause_count: hasSpeechAPI && pauseCountRef.current > 0 ? pauseCountRef.current : undefined,
      })

      setTranscript(prev => [...prev, { question, answer: answerText }])
      setFinalTranscript('')
      setTextAnswer('')
      setVoiceState('idle')

      if (result.is_complete || !result.question) {
        router.push(`/results/${sessionId}`)
        return
      }

      setQuestion(result.question)
      setPhase(result.phase)
      setDifficulty(result.difficulty_level)
      setQuestionCount(result.question_count)
      setAvatarState('questioning')
      answerStartRef.current = new Date()
      setTimeout(() => setAvatarState('listening'), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed. Try again.')
      setAvatarState('listening')
      if (hasSpeechAPI) setVoiceState('reviewing')
    } finally {
      setSubmitting(false)
    }
  }, [hasSpeechAPI, finalTranscript, textAnswer, question, submitting, sessionId, router])

  // Cmd/Ctrl+Enter submits when in reviewing state (or text-fallback mode)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (voiceState === 'reviewing' || !hasSpeechAPI) handleSubmit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleSubmit, voiceState, hasSpeechAPI])

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

  const canSubmit = hasSpeechAPI
    ? voiceState === 'reviewing' && finalTranscript.trim().length > 0
    : textAnswer.trim().length > 0

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
          <div className="w-px h-16 bg-gradient-to-b from-transparent via-white/[0.06] to-transparent" />
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
              </div>
              <p className="font-mono text-slate-100 text-[15px] leading-relaxed">
                {question.question_text}
              </p>
            </div>

            {/* Answer input */}
            <div className="animate-fade-up" style={{ animationDelay: '0.1s' }}>
              {hasSpeechAPI ? (

                /* ── Voice recording UI ──────────────────────────── */
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 space-y-4">

                  {/* IDLE: big mic button */}
                  {voiceState === 'idle' && (
                    <div className="flex flex-col items-center gap-4 py-6">
                      <button
                        onClick={startRecording}
                        disabled={avatarState === 'thinking' || submitting}
                        className="
                          w-16 h-16 rounded-full border-2 border-teal-400/40 bg-teal-400/8
                          flex items-center justify-center
                          hover:bg-teal-400/15 hover:border-teal-400/60 enabled:glow-teal
                          transition-all duration-200
                          disabled:opacity-30 disabled:cursor-not-allowed
                        "
                      >
                        <Mic size={24} className="text-teal-400" />
                      </button>
                      <p className="font-mono text-xs text-slate-600 tracking-wider">
                        {avatarState === 'thinking' ? 'Processing…' : 'Press to speak your answer'}
                      </p>
                      {error && <p className="font-mono text-[10px] text-red-400">{error}</p>}
                    </div>
                  )}

                  {/* RECORDING: live waveform + transcript */}
                  {voiceState === 'recording' && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                          <span className="font-mono text-[10px] text-red-400 tracking-widest uppercase">Recording</span>
                          <Waveform />
                        </div>
                        <button
                          onClick={stopRecording}
                          className="
                            flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                            border border-red-400/30 bg-red-400/8 text-red-400
                            font-mono text-[10px] tracking-widest uppercase
                            hover:bg-red-400/15 hover:border-red-400/50
                            transition-all duration-150
                          "
                        >
                          <Square size={10} />
                          Stop
                        </button>
                      </div>

                      <div className="min-h-[80px] rounded-xl border border-white/[0.04] bg-black/20 px-4 py-3">
                        <p className="font-mono text-sm text-slate-300 leading-relaxed">
                          {liveTranscript || (
                            <span className="text-slate-700 italic">Listening…</span>
                          )}
                        </p>
                      </div>

                      {liveTranscript && (
                        <p className="font-mono text-[10px] text-slate-700 text-right">
                          {liveTranscript.trim().split(/\s+/).filter(Boolean).length} words
                        </p>
                      )}
                    </div>
                  )}

                  {/* REVIEWING: editable transcript + submit */}
                  {voiceState === 'reviewing' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[9px] tracking-widest text-slate-600 uppercase">
                          Review your answer
                        </span>
                        <span className="font-mono text-[9px] text-slate-700">
                          Edit if needed, then submit
                        </span>
                      </div>

                      <textarea
                        value={finalTranscript}
                        onChange={e => setFinalTranscript(e.target.value)}
                        disabled={submitting}
                        className="
                          w-full min-h-[140px] resize-none rounded-xl
                          border border-white/[0.06] bg-white/[0.02]
                          px-4 py-3 font-mono text-sm text-slate-200
                          focus:outline-none focus:border-teal-400/30
                          transition-all duration-200
                          disabled:opacity-40 disabled:cursor-not-allowed
                        "
                      />

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-[10px] text-slate-700">
                            {finalTranscript.trim().split(/\s+/).filter(Boolean).length} words
                          </span>
                          {error && <span className="font-mono text-[10px] text-red-400">{error}</span>}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setFinalTranscript(''); setVoiceState('idle') }}
                            disabled={submitting}
                            className="
                              flex items-center gap-1.5 px-3 py-2 rounded-xl
                              border border-slate-700 text-slate-500
                              font-mono text-[10px] tracking-wider uppercase
                              hover:border-slate-600 hover:text-slate-400
                              transition-all duration-150
                              disabled:opacity-30 disabled:cursor-not-allowed
                            "
                          >
                            <RotateCcw size={11} />
                            Re-record
                          </button>

                          <button
                            onClick={handleSubmit}
                            disabled={!canSubmit || submitting}
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
                  )}
                </div>

              ) : (

                /* ── Fallback: text input (Firefox / no mic) ───── */
                <div>
                  <textarea
                    ref={textareaRef}
                    value={textAnswer}
                    onChange={e => setTextAnswer(e.target.value)}
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
                      {textAnswer.length > 0 ? `${textAnswer.split(/\s+/).filter(Boolean).length} words` : ''}
                    </span>
                    {error && <span className="font-mono text-[10px] text-red-400">{error}</span>}
                    <button
                      onClick={handleSubmit}
                      disabled={!canSubmit || submitting}
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
              )}
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
