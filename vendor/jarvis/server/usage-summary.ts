// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)
//
// MODIFIED 2026-11-07 for Jarvis Squad Starter project-only isolation
// (new file, not part of upstream v2.20.6 — see MODIFICATIONS).
//
// Optional, OFF-BY-DEFAULT recorded-usage panel backend. Reads exactly two fixed
// files under <project>/.local via the same safe reader as the agents roster
// (no symlink/junction/hardlink, realpath contained, regular file, 64 KB cap):
//   .local/usage-panel.json   {"enabled": true} opt-in flag
//   .local/usage-summary.json written by scripts/usage-summary.mjs (aggregates only)
// The summary is validated strictly and only whitelisted fields are returned.
// No client-supplied path exists. No GitHub data is read. Node built-ins only.

import fs from 'fs'
import path from 'path'
import { readAllowedRecord, sanitizeText } from './agents-roster.js'

export const USAGE_CONFIG_FILE = '.local/usage-panel.json'
export const USAGE_SUMMARY_FILE = '.local/usage-summary.json'
export const USAGE_FILES: readonly string[] = Object.freeze([USAGE_CONFIG_FILE, USAGE_SUMMARY_FILE])

export const MAX_BUCKETS = 50
export const MAX_NOTES = 10
export const STALE_AFTER_SECONDS = 24 * 60 * 60
const MAX_LABEL = 120
const MAX_NOTE = 200
const MAX_COUNT = 1e15
const MAX_MULTIPLIER = 1e12
const MAX_FUTURE_SKEW_S = 5 * 60
const PERIOD_KEYS = ['last_24h', 'last_7d', 'all_time'] as const
const ATTRIBUTIONS = ['partial', 'none', 'proven'] as const
const KINDS = ['main', 'subagent', 'other'] as const
const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/
const PATH_LIKE = /[A-Za-z]:[\\/]|\\\\|(^|\s)\/[^\s]|\.\.[\\/]|~[\\/]/

export type UsageKind = (typeof KINDS)[number]

export interface UsageTotals {
  events: number
  runs: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  request_multiplier_sum: number
}
export interface UsageBucket extends UsageTotals {
  label: string
  kind: UsageKind
}
export interface UsagePeriod {
  totals: UsageTotals
  buckets: UsageBucket[]
}
export interface UsageSummaryView {
  generatedAt: string
  ageSeconds: number
  stale: boolean
  source: 'local-copilot-session-store'
  attribution: (typeof ATTRIBUTIONS)[number]
  periods: Record<(typeof PERIOD_KEYS)[number], UsagePeriod>
  buckets: UsageBucket[]
  notes: string[]
  githubSpend: null
  githubRemaining: null
}
export type UsageResponse =
  | { enabled: false }
  | { enabled: true; available: false; reason: string }
  | ({ enabled: true; available: true } & UsageSummaryView)

const COUNT_FIELDS = ['events', 'runs', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens'] as const

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function count(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= MAX_COUNT ? v : null
}

function safeText(v: unknown, max: number): string | null {
  const s = sanitizeText(v, max)
  if (s === null || PATH_LIKE.test(s)) return null
  return s
}

function totals(v: unknown): UsageTotals | null {
  if (!isObj(v)) return null
  const out: Record<string, number> = {}
  for (const k of COUNT_FIELDS) {
    const n = count(v[k])
    if (n === null) return null
    out[k] = n
  }
  const m = v.request_multiplier_sum
  if (typeof m !== 'number' || !Number.isFinite(m) || m < 0 || m > MAX_MULTIPLIER) return null
  out.request_multiplier_sum = m
  return out as unknown as UsageTotals
}

function buckets(v: unknown): UsageBucket[] | null {
  if (!Array.isArray(v) || v.length > MAX_BUCKETS) return null
  const out: UsageBucket[] = []
  for (const b of v) {
    if (!isObj(b)) return null
    const t = totals(b)
    const label = safeText(b.label, MAX_LABEL)
    if (!t || label === null || b.label !== label) return null
    if (typeof b.kind !== 'string' || !(KINDS as readonly string[]).includes(b.kind)) return null
    out.push({ label, kind: b.kind as UsageKind, ...t })
  }
  return out
}

/** Strict whitelist validation; returns null on any violation. Unknown fields are dropped. */
export function validateSummary(raw: unknown, now: Date = new Date()): UsageSummaryView | null {
  if (!isObj(raw) || raw.schema_version !== 1) return null
  if (raw.source !== 'local-copilot-session-store') return null
  if (typeof raw.attribution !== 'string' || !(ATTRIBUTIONS as readonly string[]).includes(raw.attribution)) return null
  if (raw.github_spend !== null || raw.github_remaining !== null) return null
  if (typeof raw.generated_at !== 'string' || !ISO_OFFSET.test(raw.generated_at)) return null
  const gen = Date.parse(raw.generated_at)
  if (!Number.isFinite(gen)) return null
  const age = Math.floor((now.getTime() - gen) / 1000)
  if (age < -MAX_FUTURE_SKEW_S) return null
  if (!isObj(raw.periods)) return null
  const periods = {} as Record<(typeof PERIOD_KEYS)[number], UsagePeriod>
  for (const k of PERIOD_KEYS) {
    const p = raw.periods[k]
    if (!isObj(p)) return null
    const t = totals(p.totals)
    const b = buckets(p.buckets)
    if (!t || !b) return null
    periods[k] = { totals: t, buckets: b }
  }
  const top = buckets(raw.buckets)
  if (!top) return null
  if (!Array.isArray(raw.notes) || raw.notes.length > MAX_NOTES) return null
  const notes: string[] = []
  for (const n of raw.notes) {
    const s = safeText(n, MAX_NOTE)
    if (s === null) return null
    notes.push(s)
  }
  const ageSeconds = Math.max(0, age)
  return {
    generatedAt: new Date(gen).toISOString(),
    ageSeconds,
    stale: ageSeconds > STALE_AFTER_SECONDS,
    source: 'local-copilot-session-store',
    attribution: raw.attribution as UsageSummaryView['attribution'],
    periods,
    buckets: top,
    notes,
    githubSpend: null,
    githubRemaining: null,
  }
}

export function isUsageEnabled(projectRoot: string): boolean {
  const rec = readAllowedRecord(projectRoot, USAGE_CONFIG_FILE, USAGE_FILES)
  if (!rec) return false
  try {
    const cfg: unknown = JSON.parse(rec.text)
    return isObj(cfg) && cfg.enabled === true
  } catch {
    return false
  }
}

const NOT_VALID = 'The usage summary is not valid and was ignored.'

function summaryMissing(projectRoot: string): boolean {
  try {
    fs.lstatSync(path.join(projectRoot, '.local', 'usage-summary.json'))
    return false
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === 'ENOENT'
  }
}

export function buildUsage(projectRoot: string, now: Date = new Date()): UsageResponse {
  if (!isUsageEnabled(projectRoot)) return { enabled: false }
  const rec = readAllowedRecord(projectRoot, USAGE_SUMMARY_FILE, USAGE_FILES)
  if (!rec) {
    if (summaryMissing(projectRoot)) return { enabled: true, available: false, reason: 'No usage summary found. Run scripts/usage-summary.mjs to create one.' }
    return { enabled: true, available: false, reason: NOT_VALID }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rec.text)
  } catch {
    return { enabled: true, available: false, reason: NOT_VALID }
  }
  const view = validateSummary(parsed, now)
  if (!view) return { enabled: true, available: false, reason: NOT_VALID }
  return { enabled: true, available: true, ...view }
}
