// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)
//
// MODIFIED 2026-11-07 for Connected AI Brain Lab project-only isolation
// (new file, not part of upstream v2.20.6 — see MODIFICATIONS).
//
// Read-only "Mission view": AGENT SQUAD roster | TASK PIPELINE | RECORDED UPDATES, plus an
// "Agent details" tab. Plain-text rendering only; one same-origin GET to /api/agents on open
// and on manual Refresh (no polling, no external hosts). Nothing here is live.

import { useCallback, useMemo, useState } from 'react'
import { Chip, FONT, THEME, TaskPipeline, glass, relTime, smallCaps, type Board } from './KanbanPanel'

type AgentState = 'configured' | 'last_reported' | 'running' | 'unknown'
type Kind = 'live_report' | 'retrospective'

interface Update {
  taskId: string
  taskTitle: string
  status: string
  reported: string | null
  kind: Kind
}

interface AgentCard {
  id: string
  name: string
  role: string
  state: AgentState
  stateReason: string
  assignedTask: string | null
  latestStatus: string | null
  statusSource: string | null
  reportedAt: string | null
  fileModified: string | null
  fileModifiedSource: string | null
  latestKind: Kind | null
  registeredAt: string | null
  blocker: string | null
  nextAction: string | null
  deliverable: string | null
  evidenceRef: string | null
  recentUpdates: Update[]
  skippedEntries: number
}

interface Roster {
  liveStatusAvailable: boolean
  limitation: string
  generatedAt: string
  projectFocus: { text: string; source: string; updatedAt: string | null } | null
  agents: AgentCard[]
  rosterReason?: string | null
  skippedCount?: number
  kanban?: Board
}

const STATE_LABEL: Record<AgentState, string> = {
  configured: 'Configured',
  last_reported: 'Last reported',
  running: 'Running',
  unknown: 'Unknown',
}
const STATE_COLOR: Record<AgentState, string> = {
  configured: '#5aa7d6',
  last_reported: '#d6b45a',
  running: '#4fd68a',
  unknown: '#8a8f98',
}
const LEGEND: Record<AgentState, string> = {
  configured: 'listed in the roster; not execution',
  last_reported: 'a saved update exists (past report, not live)',
  running: 'execution observed via a supported interface',
  unknown: 'activity cannot be verified',
}

const none = (v: string | null, what: string) => v ?? `none recorded (${what})`
const initials = (name: string) => name.trim().slice(0, 2).toUpperCase()

function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, borderRadius: '50%', flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle, rgba(167,139,250,0.22), rgba(20,26,54,0.9))', border: '2px solid rgba(127,220,255,0.65)', boxShadow: '0 0 8px rgba(127,220,255,0.35), inset 0 0 6px rgba(167,139,250,0.35)', color: '#fff', fontSize: size * 0.38 }}
    >
      {initials(name)}
    </span>
  )
}

function Row({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 9, letterSpacing: 1, opacity: 0.55, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 11, opacity: dim ? 0.6 : 0.95, wordBreak: 'break-word' }}>{value}</div>
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{ padding: '2px 8px', borderRadius: 10, cursor: 'pointer', fontFamily: FONT, fontSize: 10, background: active ? 'rgba(127,220,255,0.18)' : 'transparent', color: active ? '#fff' : THEME.accent, border: `1px solid ${active ? THEME.accent : THEME.border}` }}
    >
      {children}
    </button>
  )
}

function UpdatesFeed({ agents }: { agents: AgentCard[] }) {
  const [type, setType] = useState<'all' | Kind>('all')
  const [who, setWho] = useState<string | null>(null)

  const entries = useMemo(() => {
    const all = agents.flatMap((a) => a.recentUpdates.map((u) => ({ ...u, agent: a.name })))
    const ts = (r: string | null) => {
      const t = r ? Date.parse(r) : NaN
      return Number.isNaN(t) ? null : t
    }
    return all
      .filter((u) => (type === 'all' || u.kind === type) && (!who || u.agent === who))
      .sort((a, b) => {
        const x = ts(a.reported)
        const y = ts(b.reported)
        if (x === null && y === null) return 0
        if (x === null) return 1
        if (y === null) return -1
        return y - x
      })
  }, [agents, type, who])

  return (
    <section className="mv-col" style={{ ...glass(), flex: '1 1 270px', maxWidth: 360, padding: 12, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={smallCaps}>Recorded updates</div>
      <div style={{ marginTop: 6, padding: 6, border: '1px solid #7a5f1d', background: 'rgba(214,180,90,0.08)', fontSize: 10 }}>
        Recorded status only — not live. Jarvis is read-only.
      </div>
      <div style={{ marginTop: 8, fontSize: 9, letterSpacing: 1, color: THEME.dim }}>TYPE</div>
      <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <FilterChip active={type === 'all'} onClick={() => setType('all')}>All</FilterChip>
        <FilterChip active={type === 'live_report'} onClick={() => setType('live_report')}>Live reports</FilterChip>
        <FilterChip active={type === 'retrospective'} onClick={() => setType('retrospective')}>Retrospective</FilterChip>
      </div>
      <div style={{ marginTop: 8, fontSize: 9, letterSpacing: 1, color: THEME.dim }}>AGENT</div>
      <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <FilterChip active={who === null} onClick={() => setWho(null)}>All agents</FilterChip>
        {agents.map((a) => (
          <FilterChip key={a.id} active={who === a.name} onClick={() => setWho(a.name)}>{a.name}</FilterChip>
        ))}
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.length === 0 && <div style={{ fontSize: 10, color: THEME.dim }}>No recorded updates match.</div>}
        {entries.map((u, i) => (
          <div key={`${u.agent}/${u.taskId}/${i}`} style={{ display: 'flex', gap: 8, padding: 8, borderRadius: 6, background: THEME.card, border: `1px solid ${THEME.border}` }}>
            <Avatar name={u.agent} size={24} />
            <div style={{ minWidth: 0, fontSize: 10, wordBreak: 'break-word' }}>
              <div>
                <span style={{ color: '#fff' }}>{u.agent}</span> recorded <span style={{ color: THEME.accent }}>{u.status}</span> for {u.taskId} — {u.taskTitle}
              </div>
              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                {u.kind === 'retrospective' && <Chip color="#b0b5bd">Retrospective</Chip>}
                <span style={{ color: THEME.dim }}>
                  {u.reported ? `reported ${relTime(u.reported)} (${u.reported})` : 'time unknown'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Roster({ agents }: { agents: AgentCard[] }) {
  return (
    <section className="mv-col" style={{ ...glass(), flex: '1 1 190px', maxWidth: 260, padding: 12, minWidth: 0 }}>
      <div style={smallCaps}>Agent squad</div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {agents.map((a) => (
          <div key={a.id} className="mv-tile" title={a.stateReason} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderRadius: 8, background: THEME.card, border: `1px solid ${STATE_COLOR[a.state]}44` }}>
            <Avatar name={a.name} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, color: '#fff' }}>{a.name}</div>
              <div style={{ fontSize: 9, color: THEME.dim, wordBreak: 'break-word' }}>{a.role}</div>
              <div style={{ marginTop: 2, fontSize: 10, color: STATE_COLOR[a.state] }}>● {STATE_LABEL[a.state]}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function AgentDetails({ agents }: { agents: AgentCard[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
      {agents.map((a) => (
        <div key={a.id} className="mv-tile" style={{ ...glass(), border: `1px solid ${STATE_COLOR[a.state]}55`, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Avatar name={a.name} />
              <div>
                <div style={{ fontSize: 14, color: '#fff' }}>{a.name}</div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>{a.role}</div>
              </div>
            </div>
            <span title={a.stateReason} style={{ alignSelf: 'flex-start', fontSize: 10, padding: '2px 8px', borderRadius: 10, border: `1px solid ${STATE_COLOR[a.state]}`, color: STATE_COLOR[a.state] }}>
              {STATE_LABEL[a.state]}
            </span>
          </div>
          <Row label="Task" value={none(a.assignedTask, 'no saved update')} dim={!a.assignedTask} />
          <Row
            label="Last reported status"
            value={
              a.state === 'last_reported' && a.latestStatus
                ? `Last reported: ${a.latestStatus} (reported ${a.reportedAt ?? 'time unknown'})`
                : none(a.state === 'last_reported' ? a.latestStatus : null, 'no saved update')
            }
            dim={a.state !== 'last_reported'}
          />
          {a.latestKind === 'retrospective' && <Row label="Entry type" value="Retrospective summary" />}
          <Row
            label="Reported time (from record)"
            value={a.reportedAt && a.state === 'last_reported' ? `${a.reportedAt} — ${a.statusSource}` : a.state === 'last_reported' ? `unknown — ${a.statusSource}` : 'no saved update'}
            dim={!a.reportedAt}
          />
          <Row
            label="File modified (filesystem)"
            value={a.fileModified && a.fileModifiedSource ? `${a.fileModified} — ${a.fileModifiedSource}` : 'not available'}
            dim={!a.fileModified}
          />
          <Row label="Blocker" value={none(a.blocker, 'not recorded')} dim={!a.blocker} />
          <Row label="Next action" value={none(a.nextAction, 'not recorded')} dim={!a.nextAction} />
          <Row label="Deliverable" value={none(a.deliverable, 'not recorded')} dim={!a.deliverable} />
          <Row label="Evidence" value={none(a.evidenceRef, 'not recorded')} dim={!a.evidenceRef} />
          {a.skippedEntries > 0 && <Row label="Skipped entries" value={`${a.skippedEntries} malformed entr${a.skippedEntries === 1 ? 'y' : 'ies'} ignored`} dim />}
          {a.recentUpdates.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 10, cursor: 'pointer', opacity: 0.8 }}>Recent updates ({a.recentUpdates.length})</summary>
              {a.recentUpdates.map((u, i) => (
                <div key={i} style={{ fontSize: 10, marginTop: 4, opacity: 0.85, wordBreak: 'break-word' }}>
                  {u.taskId} — {u.taskTitle} — {u.status} — {u.reported ?? 'time unknown'}
                  {u.kind === 'retrospective' ? ' — Retrospective summary' : ''}
                </div>
              ))}
            </details>
          )}
        </div>
      ))}
    </div>
  )
}

const MV_CSS = `
.mv-tile, .mv-chip { transition: box-shadow 0.2s ease, border-color 0.2s ease; }
.mv-tile:hover { box-shadow: 0 0 12px rgba(127,220,255,0.28), 0 0 18px rgba(167,139,250,0.16); }
.mv-chip:hover { border-color: #7fdcff !important; box-shadow: 0 0 8px rgba(127,220,255,0.35); }
@media (max-width: 720px) { .mv-col { flex-basis: 100% !important; max-width: none !important; } }
`

function SummaryStrip({ roster }: { roster: Roster }) {
  const reported = roster.agents.filter((a) => a.state === 'last_reported').length
  const updates = roster.agents.reduce((n, a) => n + a.recentUpdates.length, 0)
  const items: [string, number][] = [
    ['Agents configured', roster.agents.length],
    ['With last reported update', reported],
    ...(roster.kanban?.columns ?? []).map((c): [string, number] => [c.name, c.total]),
    ['Updates shown', updates],
  ]
  return (
    <div aria-label="Recorded counts" style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {items.map(([label, n]) => (
        <div key={label} className="mv-chip" style={{ ...glass(), padding: '4px 10px', borderRadius: 8, fontSize: 10 }}>
          <span style={{ color: '#fff', fontSize: 13, marginRight: 6 }}>{n}</span>
          <span style={{ color: THEME.dim, fontVariant: 'small-caps', letterSpacing: 1 }}>{label.toLowerCase()}</span>
        </div>
      ))}
    </div>
  )
}

const btnStyle = (right: number) =>
  ({
    position: 'fixed', bottom: 16, right, zIndex: 300, padding: '6px 12px',
    background: 'rgba(0,20,30,0.85)', color: '#7fdcff', border: '1px solid #1d5f7a',
    borderRadius: 4, cursor: 'pointer', fontFamily: FONT, fontSize: 12, letterSpacing: 1,
  }) as const

export function AgentsPanel() {
  const [tab, setTab] = useState<'tasks' | 'agents' | null>(null)
  const [roster, setRoster] = useState<Roster | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/agents', { method: 'GET', headers: { Accept: 'application/json' } })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setRoster((await r.json()) as Roster)
    } catch (e) {
      setError(`Could not load agent records (${e instanceof Error ? e.message : 'error'}).`)
    } finally {
      setLoading(false)
    }
  }, [])

  const toggle = (which: 'tasks' | 'agents') => {
    if (tab === which) {
      setTab(null)
      return
    }
    const wasClosed = tab === null
    setTab(which)
    if (wasClosed && !roster) void load()
  }

  const tabBtn = (which: 'tasks' | 'agents', label: string) => (
    <button
      onClick={() => setTab(which)}
      aria-pressed={tab === which}
      style={{ padding: '4px 14px', borderRadius: 4, cursor: 'pointer', fontFamily: FONT, fontSize: 12, background: tab === which ? 'rgba(127,220,255,0.15)' : 'transparent', color: tab === which ? '#fff' : THEME.accent, border: `1px solid ${tab === which ? THEME.accent : THEME.border}` }}
    >
      {label}
    </button>
  )

  return (
    <>
      <style>{MV_CSS}</style>
      <button onClick={() => toggle('agents')} aria-expanded={tab === 'agents'} style={btnStyle(16)}>
        {tab === 'agents' ? 'CLOSE AGENTS' : 'AGENTS'}
      </button>
      <button onClick={() => toggle('tasks')} aria-expanded={tab === 'tasks'} style={btnStyle(130)}>
        {tab === 'tasks' ? 'CLOSE KANBAN' : 'KANBAN'}
      </button>
      {tab && (
        <div
          role="dialog"
          aria-label="Mission view (read-only)"
          style={{
            position: 'fixed', top: 60, bottom: 56, left: '50%', transform: 'translateX(-50%)',
            width: 'min(1500px, 96vw)', zIndex: 299, overflow: 'auto', padding: 16,
            background: 'radial-gradient(ellipse at top, rgba(18,28,64,0.97), rgba(6,8,20,0.98))', border: '1px solid rgba(127,220,255,0.35)', borderRadius: 12, boxShadow: '0 0 24px rgba(127,220,255,0.15), 0 0 40px rgba(167,139,250,0.10)',
            color: THEME.text, fontFamily: FONT,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ ...smallCaps, fontSize: 15, marginRight: 8 }}>Mission view — read-only</div>
              {tabBtn('tasks', 'Tasks')}
              {tabBtn('agents', 'Agent details')}
            </div>
            <button
              onClick={() => void load()}
              disabled={loading}
              style={{ background: 'transparent', color: THEME.accent, border: `1px solid ${THEME.border}`, borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontFamily: FONT, fontSize: 11 }}
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          <div style={{ marginTop: 10, padding: 8, border: '1px solid #7a5f1d', background: 'rgba(214,180,90,0.08)', fontSize: 11 }}>
            {roster?.limitation ?? 'Live agent status is unavailable. Cards show saved records only.'}
          </div>

          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 10 }}>
            {(Object.keys(STATE_LABEL) as AgentState[]).map((s) => (
              <span key={s}>
                <span style={{ color: STATE_COLOR[s] }}>● {STATE_LABEL[s]}</span> = {LEGEND[s]}
              </span>
            ))}
          </div>

          {error && <div style={{ marginTop: 10, color: '#ff8a8a', fontSize: 11 }}>{error}</div>}
          {roster?.rosterReason && (
            <div style={{ marginTop: 10, padding: 8, border: '1px solid #7a5f1d', fontSize: 11 }}>{roster.rosterReason}</div>
          )}
          {roster && (roster.skippedCount ?? 0) > 0 && (
            <div style={{ marginTop: 6, fontSize: 10, opacity: 0.7 }}>{roster.skippedCount} roster entr{roster.skippedCount === 1 ? 'y' : 'ies'} skipped (invalid, retired or over the 20-member cap).</div>
          )}
          {roster?.projectFocus && (
            <div style={{ marginTop: 8, fontSize: 10, opacity: 0.7 }}>
              Project focus (recorded): {roster.projectFocus.text} — {roster.projectFocus.source}
              {roster.projectFocus.updatedAt ? `, ${roster.projectFocus.updatedAt}` : ''}
            </div>
          )}

          {roster && <SummaryStrip roster={roster} />}

          <div style={{ marginTop: 12 }}>
            {tab === 'tasks' ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
                <Roster agents={roster?.agents ?? []} />
                <div style={{ flex: '3 1 520px', minWidth: 0, display: 'flex' }}>
                  <TaskPipeline board={roster?.kanban ?? null} />
                </div>
                <UpdatesFeed agents={roster?.agents ?? []} />
              </div>
            ) : (
              <AgentDetails agents={roster?.agents ?? []} />
            )}
          </div>
        </div>
      )}
    </>
  )
}
