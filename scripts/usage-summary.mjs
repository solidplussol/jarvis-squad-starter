#!/usr/bin/env node
// Jarvis Squad Starter - local usage summary collector (USER-RUN, optional).
//
// WHAT IT READS: the local Copilot CLI session store (SQLite, opened READ-ONLY) -
// <COPILOT_HOME or ~/.copilot>/session-store.db. Only these columns are selected:
//   assistant_usage_events: model, agent_id, parent_tool_call_id (presence only),
//     input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
//     reasoning_tokens, request_multiplier, created_at
//   sessions: id and cwd (join / project filter only; never output)
// It never selects message, prompt, summary, user_message, assistant_response,
// file, ref or checkpoint columns, never touches credential/config files, uses no
// network, and logs only counts. It reads aggregates only.
//
// WHAT IT WRITES: <repo>/.local/usage-summary.json (atomic temp+rename, compact JSON),
// aggregate totals only. Nothing is written if the store cannot be found or opened.
// --out must be inside <project>/.local; anything else is refused.
//
// PROJECT FILTER: sessions are matched on an EXACT cwd (case-insensitive, trailing
// slash ignored). Sessions started in a subdirectory of the project are excluded.
//
// ATTRIBUTION: the store records opaque subagent ids, not specialist names, and no
// non-content column links them to a name. Buckets are therefore "Main thread"
// (no agent_id) and "Subagent runs (not attributed to a specialist)", split by
// model. Names are never guessed. request_multiplier is a premium-request
// multiplier, NOT dollars.
//
// Usage: node scripts/usage-summary.mjs [--db <store.db>] [--project <dir>] [--out <file>]
//   --db       store path (default: $COPILOT_HOME or ~/.copilot, session-store.db)
//   --project  project cwd filter (default: this repository root)
//   --out      output file inside <project>/.local (default: <repo>/.local/usage-summary.json)
// Requires Node 24 (node:sqlite). Periods: last 24 hours, last 7 days, all time.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_BUCKETS = 50
const MAX_OUTPUT_BYTES = 60 * 1024
const MAIN_LABEL = 'Main thread'
const SUB_LABEL = 'Subagent runs (not attributed to a specialist)'
const OTHER_LABEL = 'Other subagent runs'
const OTHER_MAIN_LABEL = 'Other main thread'
const TOKEN_FIELDS = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens']

function fail(msg) {
  console.error(`usage-summary: ${msg}`)
  process.exit(1)
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]
    if (!['--db', '--project', '--out'].includes(k) || argv[i + 1] === undefined) fail(`unknown or incomplete argument: ${k}`)
    out[k.slice(2)] = argv[i + 1]
  }
  return out
}

const here = path.dirname(fileURLToPath(import.meta.url))
const args = parseArgs(process.argv.slice(2))
const projectDir = path.resolve(args.project ?? path.join(here, '..'))
const outFile = path.resolve(args.out ?? path.join(projectDir, '.local', 'usage-summary.json'))
const dbFile = path.resolve(args.db ?? path.join(process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot'), 'session-store.db'))

const localDir = path.join(projectDir, '.local')
const rel = path.relative(localDir, outFile)
if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) fail('--out must be a file inside <project>\\.local; nothing written.')
try {
  if (fs.lstatSync(localDir).isSymbolicLink()) fail('.local must not be a symlink or junction; nothing written.')
} catch (e) {
  if (e?.code !== 'ENOENT') fail('could not inspect the .local folder; nothing written.')
}

const homeRel = path.relative(os.homedir(), dbFile)
if (homeRel.startsWith('..') || path.isAbsolute(homeRel)) console.error('usage-summary: warning: the session store path is outside your home folder.')

if (!fs.existsSync(dbFile)) fail('Copilot session store not found; nothing written. (Set COPILOT_HOME or use --db.)')

let DatabaseSync
try {
  ;({ DatabaseSync } = await import('node:sqlite'))
} catch {
  fail('node:sqlite is unavailable (Node 24 required); nothing written.')
}

const normCwd = (p) => path.resolve(p).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

let rows
try {
  const db = new DatabaseSync(dbFile, { readOnly: true })
  try {
    rows = db
      .prepare(
        `SELECT e.model AS model, e.agent_id AS agent_id,
                (e.parent_tool_call_id IS NOT NULL) AS has_parent,
                e.input_tokens AS input_tokens, e.output_tokens AS output_tokens,
                e.cache_read_tokens AS cache_read_tokens, e.cache_write_tokens AS cache_write_tokens,
                e.reasoning_tokens AS reasoning_tokens, e.request_multiplier AS request_multiplier,
                e.created_at AS created_at
         FROM assistant_usage_events e
         JOIN sessions s ON s.id = e.session_id
         WHERE lower(rtrim(replace(s.cwd, '/', '\\'), '\\')) = ?`,
      )
      .all(normCwd(projectDir))
  } finally {
    db.close()
  }
} catch {
  fail('could not read the Copilot session store (unexpected schema or locked); nothing written.')
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
const toMs = (s) => {
  if (typeof s !== 'string') return NaN
  return Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : s.replace(' ', 'T') + 'Z')
}
const cleanModel = (m) => (typeof m === 'string' ? m.replace(/[^A-Za-z0-9._:+\- ]/g, '').trim().slice(0, 40) : '') || 'unknown model'

const now = Date.now()
const windows = { last_24h: now - 24 * 3600e3, last_7d: now - 7 * 24 * 3600e3, all_time: -Infinity }

const emptyAcc = () => ({ events: 0, runSet: new Set(), request_multiplier_sum: 0, ...Object.fromEntries(TOKEN_FIELDS.map((f) => [f, 0])) })
function add(acc, r) {
  acc.events += 1
  if (r.agent_id) acc.runSet.add(r.agent_id)
  acc.request_multiplier_sum += num(r.request_multiplier)
  for (const f of TOKEN_FIELDS) acc[f] += num(r[f])
}
function merge(accs) {
  const m = emptyAcc()
  for (const a of accs) {
    m.events += a.events
    for (const id of a.runSet) m.runSet.add(id)
    m.request_multiplier_sum += a.request_multiplier_sum
    for (const f of TOKEN_FIELDS) m[f] += a[f]
  }
  return m
}
const finish = (acc) => ({
  events: acc.events,
  runs: acc.runSet.size,
  input_tokens: acc.input_tokens,
  output_tokens: acc.output_tokens,
  cache_read_tokens: acc.cache_read_tokens,
  cache_write_tokens: acc.cache_write_tokens,
  reasoning_tokens: acc.reasoning_tokens,
  request_multiplier_sum: Math.round(acc.request_multiplier_sum * 1e6) / 1e6,
})
const size = (b) => TOKEN_FIELDS.reduce((n, f) => n + b.acc[f], 0)

function summarize(since, cap) {
  const map = new Map()
  const total = emptyAcc()
  for (const r of rows) {
    if (since !== -Infinity && !(toMs(r.created_at) >= since)) continue
    const kind = r.agent_id ? 'subagent' : 'main'
    const model = cleanModel(r.model)
    const key = `${kind}\u0000${model}`
    if (!map.has(key)) map.set(key, { kind, model, acc: emptyAcc() })
    add(map.get(key).acc, r)
    add(total, r)
  }
  const sorted = [...map.values()].sort((a, b) => size(b) - size(a))
  const keep = sorted.slice(0, cap - 2)
  const buckets = keep.map((b) => ({
    label: `${b.kind === 'main' ? MAIN_LABEL : SUB_LABEL} - ${b.model}`,
    kind: b.kind,
    ...finish(b.acc),
  }))
  for (const kind of ['subagent', 'main']) {
    const extra = sorted.slice(cap - 2).filter((b) => b.kind === kind)
    if (extra.length) buckets.push({ label: kind === 'main' ? OTHER_MAIN_LABEL : OTHER_LABEL, kind: 'other', ...finish(merge(extra.map((e) => e.acc))) })
  }
  return { totals: finish(total), buckets }
}

function buildSummary(cap) {
  const periods = {}
  for (const [k, since] of Object.entries(windows)) periods[k] = summarize(since, cap)
  return {
    schema_version: 1,
    generated_at: new Date(now).toISOString(),
    source: 'local-copilot-session-store',
    attribution: 'partial',
    periods,
    buckets: periods.all_time.buckets,
    notes: [
      'Recorded usage from the local Copilot session store - not live.',
      'Subagent runs are not attributed to named specialists; the store has no non-content field that names them.',
      'Main thread rows have 0 runs; request_multiplier_sum is a premium-request multiplier, not dollars.',
      'GitHub spend and remaining allowance are not configured.',
    ],
    github_spend: null,
    github_remaining: null,
  }
}

// Compact JSON; shrink the bucket cap until the file fits comfortably under the server's 64 KB limit.
let summary
let text
for (const cap of [MAX_BUCKETS, 40, 30, 20, 10, 4]) {
  summary = buildSummary(cap)
  text = JSON.stringify(summary) + '\n'
  if (Buffer.byteLength(text) <= MAX_OUTPUT_BYTES) break
}
if (Buffer.byteLength(text) > MAX_OUTPUT_BYTES) fail('summary would exceed the size limit; nothing written.')

const tmp = `${outFile}.${process.pid}.tmp`
try {
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(tmp, text, { flag: 'wx' })
  fs.renameSync(tmp, outFile)
} catch {
  try {
    fs.unlinkSync(tmp)
  } catch {
    // temp file may not exist
  }
  fail('could not write the summary file.')
}

console.log(`usage-summary: wrote summary (${rows.length} usage events for this project; ${summary.buckets.length} all-time buckets).`)
