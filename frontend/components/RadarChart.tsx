'use client'

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
} from 'recharts'

interface Props {
  scores: {
    technical: number
    communication: number
    problemSolving: number
    adaptability: number
    confidence: number
  }
}

const LABELS: Record<string, string> = {
  technical: 'Technical',
  communication: 'Communication',
  problemSolving: 'Problem Solving',
  adaptability: 'Adaptability',
  confidence: 'Confidence',
}

export default function ScoreRadar({ scores }: Props) {
  const data = Object.entries(scores).map(([key, value]) => ({
    subject: LABELS[key] ?? key,
    score: value,
    fullMark: 10,
  }))

  return (
    <ResponsiveContainer width="100%" height={320}>
      <RadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
        <PolarGrid
          stroke="rgba(148,163,184,0.1)"
          gridType="polygon"
        />
        <PolarAngleAxis
          dataKey="subject"
          tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'var(--font-mono)' }}
        />
        <Radar
          name="Score"
          dataKey="score"
          stroke="#2dd4bf"
          fill="#2dd4bf"
          fillOpacity={0.12}
          strokeWidth={2}
          dot={{ r: 3, fill: '#2dd4bf', strokeWidth: 0 }}
        />
      </RadarChart>
    </ResponsiveContainer>
  )
}
