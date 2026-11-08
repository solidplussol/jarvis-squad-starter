// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)
//
// MODIFIED 2026-11-07 for Connected AI Brain Lab project-only isolation
// (new file, not part of upstream v2.20.6 — see MODIFICATIONS).
//
// Read-only TASK PIPELINE (recorded kanban). Plain-text rendering only; no fetching here —
// the Mission view in AgentsPanel.tsx does the single same-origin GET /api/agents.
// No polling, no external hosts, no drag/drop, no editing.

import { useMemo, useState } from 'react'

export interface Task {
  taskId: string
  title: string
  agent: string
  status: string
  kind: 'live_report' | 'retrospective'
  reported: string | null
  reportedSource: string
  blocker: string | null
  nextAction: string | null
  deliverable: string | null
  evidence: string | null
}
export interface Column {
  name: string
  total: number
  tasks: Task[]
}
export interface Board {
  note: string
  columns: Column[]
}

export const FONT = "'Share Tech Mono', ui-monospace, Consolas, monospace"
export const THEME = {
  panel: 'rgba(14,16,34,0.92)',
  card: 'rgba(24,27,52,0.9)',
  border: 'rgba(120,130,200,0.28)',
  text: '#d7dcf5',
  dim: 'rgba(215,220,245,0.6)',
  accent: '#7fdcff',
  violet: '#a78bfa',
  glow: '0 0 0 1px rgba(127,220,255,0.10), 0 0 14px rgba(127,220,255,0.10), inset 0 0 18px rgba(167,139,250,0.05)',
}

// Shared static style helpers; nothing here implies activity.
export const glass = (retro = false) =>
  ({
    background: 'linear-gradient(160deg, rgba(20,26,54,0.78), rgba(12,14,32,0.88))',
    border: `1px ${retro ? 'dashed' : 'solid'} rgba(127,220,255,0.30)`,
    borderRadius: 10,
    boxShadow: THEME.glow,
  }) as const
export const smallCaps = {
  fontVariant: 'small-caps',
  textTransform: 'lowercase',
  letterSpacing: 2,
  fontSize: 12,
  color: THEME.accent,
} as const

const STATUS_LABEL: Record<string, string> = {
  started: 'Started (last reported)',
  handed_off: 'Handed off',
  blocked: 'Blocked',
  completed: 'Completed',
}
const RETRO = 'Recorded retrospective'
const COLUMN_COLOR: Record<string, string> = {
  Blocked: '#e8744f',
  'Handed off': '#b48cf0',
  'In progress (last reported)': '#5b9cf0',
  Completed: '#4fc98a',
  [RETRO]: '#7fa3a8',
}
const colorFor = (name: string) => COLUMN_COLOR[name] ?? '#7fa3a8'

export function relTime(iso: string | null): string {
  if (!iso) return 'time unknown'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 0) return iso
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  if (s < 129600) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

export function Chip({ children, color, title }: { children: string; color?: string; title?: string }) {
  const c = color ?? THEME.accent
  return (
    <span title={title} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, border: `1px solid ${c}88`, color: c, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div style={{ marginTop: 4, fontSize: 10, wordBreak: 'break-word' }}>
      <span style={{ color: THEME.dim, textTransform: 'uppercase', letterSpacing: 1, fontSize: 9 }}>{label}: </span>
      <span style={{ opacity: value ? 0.95 : 0.5 }}>{value ?? 'none recorded'}</span>
    </div>
  )
}

export function TaskPipeline({ board }: { board: Board | null }) {
  const [filter, setFilter] = useState('')
  const q = filter.trim().toLowerCase()

  const view = useMemo(() => {
    const cols = (board?.columns ?? []).map((c) => ({
      ...c,
      shown: q
        ? c.tasks.filter((t) =>
            [t.title, t.agent, t.taskId, t.evidence ?? ''].some((v) => v.toLowerCase().includes(q)),
          )
        : c.tasks,
    }))
    const total = cols.reduce((n, c) => n + c.total, 0)
    const shown = cols.reduce((n, c) => n + c.shown.length, 0)
    return { cols, total, shown }
  }, [board, q])

  return (
    <section style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={smallCaps}>Task pipeline</div>
      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by title, agent, task ID or evidence"
          aria-label="Filter tasks"
          style={{ flex: 1, padding: '5px 8px', background: THEME.card, color: THEME.text, border: `1px solid ${THEME.border}`, borderRadius: 4, fontFamily: FONT, fontSize: 11 }}
        />
        <button
          onClick={() => setFilter('')}
          disabled={!filter}
          style={{ background: 'transparent', color: THEME.accent, border: `1px solid ${THEME.border}`, borderRadius: 4, padding: '4px 10px', cursor: filter ? 'pointer' : 'default', fontFamily: FONT, fontSize: 11 }}
        >
          Clear
        </button>
        <span style={{ fontSize: 10, color: THEME.dim, whiteSpace: 'nowrap' }}>
          Showing {view.shown} of {view.total}
        </span>
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'flex-start', overflowX: 'auto', paddingBottom: 6 }}>
        {view.cols.map((c) => {
          const col = colorFor(c.name)
          const retro = c.name === RETRO
          return (
            <div key={c.name} style={{ ...glass(retro), flex: '1 0 200px', minWidth: 200, padding: '0 8px 8px', overflow: 'hidden' }}>
              <div style={{ margin: '0 -8px', padding: '7px 10px', fontSize: 11, color: '#fff', letterSpacing: 1, background: `linear-gradient(90deg, ${col}66, ${col}14)`, borderBottom: `2px ${retro ? 'dashed' : 'solid'} ${col}`, textShadow: '0 0 6px rgba(0,0,0,0.6)' }}>
                {c.name} ({c.total})
              </div>
              {c.shown.length === 0 && (
                <div style={{ marginTop: 8, fontSize: 10, color: THEME.dim }}>
                  {q ? 'No tasks match the filter.' : 'No tasks recorded in this column.'}
                </div>
              )}
              {c.shown.map((t) => (
                <div
                  key={`${t.agent}/${t.taskId}`}
                  style={{ marginTop: 8, padding: '8px 8px 8px 10px', borderRadius: 6, background: THEME.card, border: `1px ${retro ? 'dashed' : 'solid'} ${THEME.border}`, borderLeft: `4px solid ${col}` }}
                >
                  <div style={{ fontSize: 9, color: THEME.dim, wordBreak: 'break-word' }}>{t.taskId}</div>
                  <div style={{ fontSize: 11, color: '#fff', wordBreak: 'break-word' }}>{t.title}</div>
                  <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    <Chip>{t.agent}</Chip>
                    <Chip color={t.kind === 'retrospective' ? '#b0b5bd' : '#d6b45a'}>
                      {t.kind === 'retrospective' ? 'Retrospective' : 'Live report (recorded)'}
                    </Chip>
                    <Chip color={col}>{STATUS_LABEL[t.status] ?? t.status}</Chip>
                  </div>
                  <div style={{ marginTop: 5, fontSize: 10, color: THEME.dim }}>
                    Reported {t.reported ? `${relTime(t.reported)} (${t.reported})` : 'time unknown'} — {t.reportedSource}
                  </div>
                  <details style={{ marginTop: 5 }}>
                    <summary style={{ fontSize: 10, cursor: 'pointer', color: THEME.accent }}>Details</summary>
                    <Field label="Blocker" value={t.blocker} />
                    <Field label="Next action" value={t.nextAction} />
                    <Field label="Deliverable" value={t.deliverable} />
                    <Field label="Evidence" value={t.evidence} />
                  </details>
                </div>
              ))}
              {c.total > c.tasks.length && (
                <div style={{ marginTop: 8, fontSize: 10, color: THEME.dim }}>
                  Showing {c.tasks.length} of {c.total}; remaining tasks are not shown.
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
