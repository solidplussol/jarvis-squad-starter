// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)
//
// MODIFIED 2026-11-07 for Connected AI Brain Lab project-only isolation
// (new file, not part of upstream v2.20.6 — see MODIFICATIONS).
//
// Read-only Agents roster. A separate, narrow read boundary from the vault
// content-path policy: it can read ONLY the fixed Squad record files below plus,
// for each roster member validated from team.md (strict lowercase slug), that
// member's charter.md and docs/status/<id>.md (resolved under the project root, no globbing, no directory
// listing), rejects symlinks/junctions and anything escaping the project, and
// extracts a few capped plain-text fields. Histories, prompts, config, full
// charters and decisions are never read into output. Node built-ins only.

import fs from 'fs'
import path from 'path'
import { isInside } from './content-path.js'

/** Validated member id: lowercase slug (see normalizeMemberId). Never a raw name from a file. */
export type AgentId = string

export type AgentState = 'configured' | 'last_reported' | 'running' | 'unknown'

/** Project-relative, '/'-separated. The ONLY files this module will ever open. */
export const TEAM_FILE = '.squad/team.md'
export const REGISTRY_FILE = '.squad/casting/registry.json'
export const NOW_FILE = '.squad/identity/now.md'

export const MAX_MEMBERS = 20
const MEMBER_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const MEMBER_NAME_RAW = /^[A-Za-z0-9](?:[A-Za-z0-9 \t-]{0,58}[A-Za-z0-9])?$/ // ASCII only, checked BEFORE lowercasing (e.g. U+212A lowercases to "k"); no trailing space/hyphen
const RESERVED_WINDOWS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|readme)$/

/**
 * Returns the validated lowercase slug for a roster name, or null. Spaces become hyphens;
 * dots, slashes, colons, unicode, trailing dots/spaces and reserved Windows device names are rejected.
 */
export function normalizeMemberId(name: unknown): string | null {
  if (typeof name !== 'string' || !MEMBER_NAME_RAW.test(name)) return null
  const id = name.replace(/[ \t]+/g, '-').toLowerCase()
  if (!MEMBER_ID.test(id) || RESERVED_WINDOWS.test(id)) return null
  return id
}

/** Paths are only ever built from a validated id into these fixed templates. */
function assertId(id: string): string {
  if (normalizeMemberId(id) !== id) throw new Error('invalid member id')
  return id
}
export const charterFile = (id: AgentId) => `.squad/agents/${assertId(id)}/charter.md`

/** Per-member status record; format documented in docs/status/README.md. */
export const statusFile = (id: AgentId) => `docs/status/${assertId(id)}.md`

/** The fixed files; per-member charter/status files are added only from validated roster ids. */
export const FIXED_RECORD_FILES: readonly string[] = Object.freeze([TEAM_FILE, REGISTRY_FILE, NOW_FILE])
export const allowListFor = (ids: readonly string[]): readonly string[] =>
  Object.freeze([...FIXED_RECORD_FILES, ...ids.map(charterFile), ...ids.map(statusFile)])

const MAX_RECORD_BYTES = 64 * 1024
const MAX_FIELD_CHARS = 200
const MAX_ENTRIES_SCANNED = 200
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000
export const MAX_ENTRIES_PER_AGENT = 20
export const MAX_RECENT_SHOWN = 5

export const UPDATE_STATUSES = ['started', 'handed_off', 'blocked', 'completed'] as const
export const UPDATE_KINDS = ['live_report', 'retrospective'] as const
export type UpdateStatus = (typeof UPDATE_STATUSES)[number]
export type UpdateKind = (typeof UPDATE_KINDS)[number]

export interface StatusUpdate {
  taskId: string
  taskTitle: string
  status: UpdateStatus
  /** ISO-8601 UTC from the record itself, or null when the record says "unknown". */
  reported: string | null
  kind: UpdateKind
  blocker: string | null
  nextAction: string | null
  deliverable: string | null
  evidence: string | null
}

export interface ParsedStatus {
  entries: StatusUpdate[] // newest first, capped
  skipped: number // malformed entries (not exposed)
  totalValid: number
}

export const LIMITATION =
  'Live agent status is unavailable: no supported Squad interface exposes current execution. ' +
  'Cards show roster configuration and saved records only; "configured" does not mean running.'

export interface AgentCard {
  id: AgentId
  name: string
  role: string
  state: AgentState
  stateReason: string
  assignedTask: string | null // "<taskId>: <title>" from the latest entry
  latestStatus: string | null
  statusSource: string | null // status record file, or team.md when only the roster row exists
  /** Reported time comes from inside the record; fileModified is the filesystem mtime. Never conflated. */
  reportedAt: string | null
  reportedAtSource: 'record' | null
  fileModified: string | null
  fileModifiedSource: string | null
  latestKind: UpdateKind | null
  registeredAt: string | null
  blocker: string | null
  nextAction: string | null
  deliverable: string | null
  evidenceRef: string | null
  recentUpdates: StatusUpdate[]
  skippedEntries: number
}

export interface RosterResponse {
  liveStatusAvailable: boolean
  limitation: string
  generatedAt: string
  allowedRecords: string[]
  rosterSource: string
  /** Null when a roster was found; otherwise a fixed "No roster found: ..." reason. */
  rosterReason: string | null
  /** Names skipped (invalid, over the cap, or retired); never echoed. */
  skippedCount: number
  projectFocus: { text: string; source: string; updatedAt: string | null } | null
  agents: AgentCard[]
  kanban: KanbanBoard
}

export const KANBAN_COLUMNS = ['Blocked', 'Handed off', 'In progress (last reported)', 'Completed', 'Recorded retrospective'] as const
export type KanbanColumnName = (typeof KANBAN_COLUMNS)[number]
export const MAX_TASKS_PER_COLUMN = 25

export interface KanbanTask {
  taskId: string
  title: string
  agent: AgentId
  status: UpdateStatus
  kind: UpdateKind
  reported: string | null
  reportedSource: string
  blocker: string | null
  nextAction: string | null
  deliverable: string | null
  evidence: string | null
}
export interface KanbanColumn {
  name: KanbanColumnName
  total: number
  tasks: KanbanTask[]
}
export interface KanbanBoard {
  note: string
  columns: KanbanColumn[]
}

const KANBAN_NOTE = 'Recorded status only - not live; tasks are reconstructed from saved status records.'
const STATUS_COLUMN: Record<UpdateStatus, KanbanColumnName> = {
  blocked: 'Blocked',
  handed_off: 'Handed off',
  started: 'In progress (last reported)',
  completed: 'Completed',
}

/** One card per agent+taskId, placed by its latest valid entry (entries must be newest first). */
export function buildKanban(perAgent: { id: AgentId; entries: StatusUpdate[] }[]): KanbanBoard {
  const cols = new Map<KanbanColumnName, KanbanTask[]>(KANBAN_COLUMNS.map((c) => [c, []]))
  for (const { id, entries } of perAgent) {
    const seen = new Set<string>()
    for (const e of entries) {
      if (seen.has(e.taskId)) continue
      seen.add(e.taskId)
      const col = e.kind === 'retrospective' ? 'Recorded retrospective' : STATUS_COLUMN[e.status]
      cols.get(col)!.push({
        taskId: e.taskId, title: e.taskTitle, agent: id, status: e.status, kind: e.kind,
        reported: e.reported, reportedSource: statusFile(id),
        blocker: e.blocker, nextAction: e.nextAction, deliverable: e.deliverable, evidence: e.evidence,
      })
    }
  }
  const time = (t: KanbanTask) => (t.reported ? Date.parse(t.reported) : -Infinity)
  return {
    note: KANBAN_NOTE,
    columns: KANBAN_COLUMNS.map((name) => {
      const all = cols.get(name)!.sort((a, b) => time(b) - time(a))
      return { name, total: all.length, tasks: all.slice(0, MAX_TASKS_PER_COLUMN) }
    }),
  }
}

/** Plain text only: strips markup-ish and control characters, collapses whitespace, caps length. */
export function sanitizeText(input: unknown, max = MAX_FIELD_CHARS): string | null {
  if (typeof input !== 'string') return null
  let s = input.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g, ' ')
  s = s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (s.length === 0) return null
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/**
 * State label rules. "running" requires positive, observed live evidence from a
 * supported interface (none exists today, so callers never pass it);
 * "last_reported" requires a saved per-agent update record; "configured" means
 * roster membership only; otherwise "unknown".
 */
export function deriveState(input: { configured: boolean; savedUpdate: boolean; liveObserved: boolean }): AgentState {
  if (input.liveObserved) return 'running'
  if (input.savedUpdate) return 'last_reported'
  if (input.configured) return 'configured'
  return 'unknown'
}

export interface RecordRead {
  text: string
  mtime: Date
}

/**
 * Reads one allow-listed record: must be in ALLOWED_RECORD_FILES, every
 * component lstat-verified as a non-symlink/junction, realpath contained in
 * the project root, regular file, size capped. Returns null on any failure.
 */
export function readAllowedRecord(projectRoot: string, rel: string, allowed: readonly string[] = FIXED_RECORD_FILES): RecordRead | null {
  if (!allowed.includes(rel)) return null
  try {
    const rootReal = fs.realpathSync.native(projectRoot)
    const abs = path.join(rootReal, ...rel.split('/'))
    if (!isInside(rootReal, abs)) return null
    let cur = rootReal
    for (const seg of rel.split('/')) {
      cur = path.join(cur, seg)
      if (fs.lstatSync(cur).isSymbolicLink()) return null
    }
    if (!isInside(rootReal, fs.realpathSync.native(cur))) return null
    const fd = fs.openSync(cur, 'r')
    try {
      const st = fs.fstatSync(fd)
      if (!st.isFile() || st.nlink > 1 || st.size > MAX_RECORD_BYTES) return null
      return { text: fs.readFileSync(fd, 'utf-8'), mtime: st.mtime }
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
}

const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const KNOWN_KEYS: Record<string, string> = {
  agent: 'agent', 'task id': 'taskId', 'task title': 'taskTitle', status: 'status', reported: 'reported',
  blocker: 'blocker', 'next action': 'nextAction', deliverable: 'deliverable', evidence: 'evidence', kind: 'kind',
}
const NONE_VALUES = /^(none|n\/a|-|—)$/i

/**
 * Tolerant parser for docs/status/<agent>.md. Entries start at a line "## Update";
 * only known "Key: value" lines inside an entry are read, everything else is ignored.
 * Invalid entries are counted and dropped; raw text is never returned.
 */
export function parseStatusRecord(text: string, agent: AgentId, now: Date = new Date()): ParsedStatus {
  const latestAllowed = now.getTime() + MAX_FUTURE_SKEW_MS
  const raw: Record<string, string>[] = []
  let cur: Record<string, string> | null = null
  for (const line of text.split(/\r?\n/)) {
    if (/^##\s+Update\s*$/.test(line)) {
      if (raw.length >= MAX_ENTRIES_SCANNED) break
      cur = {}
      raw.push(cur)
      continue
    }
    if (!cur) continue
    const m = /^([A-Za-z ]{2,20}):[ \t]*(.*)$/.exec(line)
    if (!m) continue
    const key = KNOWN_KEYS[m[1].trim().toLowerCase()]
    if (key && !(key in cur)) cur[key] = m[2].slice(0, 1000)
  }

  let skipped = 0
  const valid: { u: StatusUpdate; pos: number; t: number | null }[] = []
  raw.forEach((f, pos) => {
    const taskId = (f.taskId ?? '').trim()
    const status = (f.status ?? '').trim().toLowerCase() as UpdateStatus
    const kind = (f.kind ?? '').trim().toLowerCase() as UpdateKind
    const title = sanitizeText(f.taskTitle, 160)
    const rep = (f.reported ?? '').trim()
    const unknownTime = rep.toLowerCase() === 'unknown'
    // A Reported time beyond now + skew is treated as forged/invalid: the entry is skipped.
    const timeOk = ISO_OFFSET.test(rep) && !Number.isNaN(Date.parse(rep)) && Date.parse(rep) <= latestAllowed
    const ok =
      (f.agent ?? '').trim().toLowerCase() === agent &&
      TASK_ID.test(taskId) &&
      title !== null &&
      (UPDATE_STATUSES as readonly string[]).includes(status) &&
      (UPDATE_KINDS as readonly string[]).includes(kind) &&
      (timeOk || (unknownTime && kind === 'retrospective'))
    if (!ok) {
      skipped++
      return
    }
    const opt = (v: string | undefined, max: number) => (v && !NONE_VALUES.test(v.trim()) ? sanitizeText(v, max) : null)
    valid.push({
      pos,
      t: timeOk ? Date.parse(rep) : null,
      u: {
        taskId, taskTitle: title!, status, kind,
        reported: timeOk ? new Date(rep).toISOString() : null,
        blocker: opt(f.blocker, 300), nextAction: opt(f.nextAction, 300), deliverable: opt(f.deliverable, 300), evidence: opt(f.evidence, 600),
      },
    })
  })
  // Newest first: timed entries by time (file position breaks ties), then untimed by file position.
  valid.sort((a, b) => {
    if (a.t !== null && b.t !== null) return b.t - a.t || b.pos - a.pos
    if (a.t !== null) return -1
    if (b.t !== null) return 1
    return b.pos - a.pos
  })
  return { entries: valid.slice(0, MAX_ENTRIES_PER_AGENT).map((v) => v.u), skipped, totalValid: valid.length }
}

interface TeamMember { id: string; role: string | null; status: string | null; name: string | null }
interface ParsedRoster { members: TeamMember[]; skipped: number; reason: string | null }

const NO_ROSTER = 'No roster found: '

/**
 * Parses the "## Members" table of team.md. Needs a header row with a Name column; Role and Status
 * columns are located by header, tolerating extra columns, spacing and markdown emphasis.
 * Invalid names are only counted (never echoed); at most MAX_MEMBERS are kept.
 */
/** Strips only a balanced outer **bold** or `code` wrapper; inner characters (e.g. a_b) stay so they fail validation. */
function unwrapEmphasis(c: string): string {
  const m = /^(\*\*|`)([^*`]*)\1$/.exec(c.trim())
  return m ? m[2] : c
}

export function parseTeamRoster(teamText: string | null): ParsedRoster {
  const empty = (why: string): ParsedRoster => ({ members: [], skipped: 0, reason: NO_ROSTER + why })
  if (!teamText) return empty('.squad/team.md is missing or unreadable.')
  const lines = teamText.split(/\r?\n/)
  const start = lines.findIndex((l) => /^##\s+Members\b/i.test(l))
  if (start < 0) return empty('team.md has no "Members" section.')
  let cols: { name: number; role: number; status: number } | null = null
  const members: TeamMember[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break
    if (!line.includes('|')) continue
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    if (cells.every((c) => /^:?-{1,}:?$/.test(c))) continue
    const clean = (c: string | undefined) => (c ?? '').replace(/[`*_]/g, '').trim()
    if (!cols) {
      const heads = cells.map((c) => clean(c).toLowerCase())
      const name = heads.indexOf('name')
      if (name >= 0) cols = { name, role: heads.indexOf('role'), status: heads.indexOf('status') }
      continue
    }
    const id = normalizeMemberId(unwrapEmphasis(cells[cols.name] ?? ''))
    if (!id) {
      skipped++
      continue
    }
    if (seen.has(id)) continue
    if (members.length >= MAX_MEMBERS) {
      skipped++
      continue
    }
    seen.add(id)
    members.push({
      id,
      name: sanitizeText(clean(cells[cols.name]), 60),
      role: cols.role >= 0 ? sanitizeText(clean(cells[cols.role]), 80) : null,
      status: cols.status >= 0 ? sanitizeText(cells[cols.status]) : null,
    })
  }
  if (!cols) return empty('team.md Members table has no header row with a Name column.')
  if (members.length === 0) return { members, skipped, reason: NO_ROSTER + 'the Members table has no valid members.' }
  return { members, skipped, reason: null }
}

function charterDeliverable(text: string | null): string | null {
  if (!text) return null
  const m = /^##\s+Deliverables\s*\r?\n+([^\r\n#][^\r\n]*)/m.exec(text)
  return m ? sanitizeText(m[1]) : null
}

function registryEntry(json: string | null, id: AgentId): { name: string | null; role: string | null; at: string | null; retired: boolean } {
  const none = { name: null, role: null, at: null, retired: false }
  if (!json) return none
  try {
    const agents = JSON.parse(json)?.agents
    const e = agents && typeof agents === 'object' && Object.prototype.hasOwnProperty.call(agents, id) ? agents[id] : null
    if (!e || typeof e !== 'object') return none
    const at = typeof e.updated_at === 'string' && !Number.isNaN(Date.parse(e.updated_at)) ? new Date(e.updated_at).toISOString() : null
    const retired = typeof e.status === 'string' && e.status.trim().toLowerCase() === 'retired'
    return { name: sanitizeText(e.display_name, 60), role: sanitizeText(e.role, 80), at, retired }
  } catch {
    return none
  }
}

function nowFocus(text: string | null, mtime: Date | undefined) {
  if (!text) return null
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  const focus = sanitizeText(/^focus_area:\s*(.+)$/m.exec(fm)?.[1])
  if (!focus) return null
  const raw = /^updated_at:\s*(\S+)$/m.exec(fm)?.[1]
  const updatedAt = raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : mtime?.toISOString() ?? null
  return { text: focus, source: NOW_FILE, updatedAt }
}

function recordPresent(projectRoot: string, rel: string, allowed: readonly string[]): boolean {
  if (!allowed.includes(rel)) return false
  try {
    fs.lstatSync(path.join(projectRoot, ...rel.split('/')))
    return true
  } catch {
    return false
  }
}

export function buildRoster(projectRoot: string, now: Date = new Date()): RosterResponse {
  const team = readAllowedRecord(projectRoot, TEAM_FILE)
  const registry = readAllowedRecord(projectRoot, REGISTRY_FILE)
  const nowRec = readAllowedRecord(projectRoot, NOW_FILE)

  const parsedRoster = parseTeamRoster(team?.text ?? null)
  let skippedCount = parsedRoster.skipped
  const members = parsedRoster.members.filter((m) => {
    const retired = registryEntry(registry?.text ?? null, m.id).retired || /^retired\b/i.test(m.status ?? '')
    if (retired) skippedCount++
    return !retired
  })
  const rosterReason =
    parsedRoster.reason ?? (members.length === 0 ? NO_ROSTER + 'every listed member is retired.' : null)
  const allowed = allowListFor(members.map((m) => m.id))

  const entriesByAgent: { id: AgentId; entries: StatusUpdate[] }[] = []
  const agents: AgentCard[] = members.map((row) => {
    const id = row.id
    const charter = readAllowedRecord(projectRoot, charterFile(id), allowed)
    const reg = registryEntry(registry?.text ?? null, id)
    const display = reg.name ?? row.name ?? id
    const configured = true

    const sf = statusFile(id)
    const rec = readAllowedRecord(projectRoot, sf, allowed)
    const parsed = rec ? parseStatusRecord(rec.text, id, now) : null
    const latest = parsed?.entries[0] ?? null
    entriesByAgent.push({ id, entries: parsed?.entries ?? [] })
    const unreadable = !rec && recordPresent(projectRoot, sf, allowed)
    const allMalformed = !!parsed && parsed.totalValid === 0 && parsed.skipped > 0
    const undetermined = unreadable || allMalformed

    const state = undetermined
      ? 'unknown'
      : deriveState({ configured, savedUpdate: latest !== null, liveObserved: false })
    const reason =
      state === 'last_reported'
        ? 'A saved update record exists; it reports past activity, not current execution.'
        : undetermined
          ? 'The status record is unreadable or has no valid entries; activity cannot be determined.'
          : state === 'configured'
            ? 'Listed in the Squad roster; no saved update yet. Roster membership is not execution.'
            : 'No roster record found; activity cannot be verified.'
    return {
      id,
      name: display,
      role: row.role ?? reg.role ?? 'not recorded',
      state,
      stateReason: reason,
      assignedTask: latest ? `${latest.taskId}: ${latest.taskTitle}` : null,
      latestStatus: latest ? latest.status : row.status,
      statusSource: latest ? sf : row.status ? TEAM_FILE : null,
      reportedAt: latest?.reported ?? null,
      reportedAtSource: latest?.reported ? 'record' : null,
      fileModified: latest && rec ? rec.mtime.toISOString() : row.status && team ? team.mtime.toISOString() : null,
      fileModifiedSource: latest && rec ? sf : row.status && team ? TEAM_FILE : null,
      latestKind: latest?.kind ?? null,
      registeredAt: reg.at,
      blocker: latest?.blocker ?? null,
      nextAction: latest?.nextAction ?? null,
      deliverable: latest?.deliverable ?? charterDeliverable(charter?.text ?? null),
      evidenceRef: latest?.evidence ?? (charter ? charterFile(id) : null),
      recentUpdates: parsed ? parsed.entries.slice(0, MAX_RECENT_SHOWN) : [],
      skippedEntries: parsed?.skipped ?? 0,
    }
  })

  return {
    liveStatusAvailable: false,
    limitation: LIMITATION,
    generatedAt: now.toISOString(),
    allowedRecords: [...allowed],
    rosterSource: TEAM_FILE,
    rosterReason,
    skippedCount,
    projectFocus: nowFocus(nowRec?.text ?? null, nowRec?.mtime),
    agents,
    kanban: buildKanban(entriesByAgent),
  }
}
