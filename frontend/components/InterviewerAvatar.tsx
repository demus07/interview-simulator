'use client'

import { Brain, Mic, Volume2 } from 'lucide-react'

export type AvatarState = 'questioning' | 'listening' | 'thinking'

const CONFIG = {
  questioning: {
    Icon: Volume2,
    label: 'SPEAKING',
    ring: 'border-teal-400',
    bg: 'bg-teal-950/50',
    icon: 'text-teal-300',
    glow: 'glow-teal',
    dot: 'bg-teal-400',
    color: 'teal',
  },
  listening: {
    Icon: Mic,
    label: 'LISTENING',
    ring: 'border-green-400',
    bg: 'bg-green-950/50',
    icon: 'text-green-300',
    glow: 'glow-green',
    dot: 'bg-green-400',
    color: 'green',
  },
  thinking: {
    Icon: Brain,
    label: 'PROCESSING',
    ring: 'border-violet-400',
    bg: 'bg-violet-950/50',
    icon: 'text-violet-300',
    glow: 'glow-violet',
    dot: 'bg-violet-400',
    color: 'violet',
  },
} as const

interface Props {
  state: AvatarState
  company?: string
}

export default function InterviewerAvatar({ state, company = 'PANEL' }: Props) {
  const c = CONFIG[state]
  const Icon = c.Icon

  return (
    <div className="flex flex-col items-center gap-4 select-none">
      {/* Avatar rings + core */}
      <div className="relative flex items-center justify-center w-36 h-36">

        {/* Animated rings — only shown when questioning */}
        {state === 'questioning' && (
          <>
            <span className="absolute inset-0 rounded-full border border-teal-400/30 animate-pulse-ring" />
            <span className="absolute inset-0 rounded-full border border-teal-400/20 animate-pulse-ring2" />
            <span className="absolute inset-0 rounded-full border border-teal-400/10 animate-pulse-ring3" />
          </>
        )}

        {/* Rotating arc when thinking */}
        {state === 'thinking' && (
          <span
            className="absolute inset-2 rounded-full border-2 border-transparent border-t-violet-400 animate-spin-slow"
            style={{ borderTopColor: '#a78bfa', borderRightColor: 'rgba(167,139,250,0.2)' }}
          />
        )}

        {/* Listening pulse */}
        {state === 'listening' && (
          <span className="absolute inset-0 rounded-full border border-green-400/20 animate-pulse" />
        )}

        {/* Main circle */}
        <div
          className={`
            relative z-10 w-24 h-24 rounded-full flex flex-col items-center justify-center gap-1
            border-2 transition-all duration-700
            ${c.ring} ${c.bg} ${c.glow}
          `}
        >
          <Icon size={26} className={`transition-colors duration-500 ${c.icon}`} />

          {/* Speaking bars only when questioning */}
          {state === 'questioning' && (
            <div className="bars-container mt-0.5">
              {[1,2,3,4,5].map(i => (
                <div
                  key={i}
                  className={`bar bg-teal-400/80`}
                  style={{ animationDelay: `${(i - 1) * 0.12}s` }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* State label + company */}
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${c.dot}`} />
          <span className="font-mono text-[10px] tracking-[0.2em] text-slate-400">
            {c.label}
          </span>
        </div>
        <span className="font-syne text-xs font-semibold text-slate-500 tracking-widest uppercase">
          {company}
        </span>
      </div>
    </div>
  )
}
