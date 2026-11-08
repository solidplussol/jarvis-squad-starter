// SPDX-License-Identifier: AGPL-3.0-only
// MODIFIED 2026-11-07 for Jarvis Squad Starter project-only isolation (new file; see MODIFICATIONS).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { HERE, SERVER_DIR, makeFixture, serverModule, tryLink } from './_helpers.mjs'

const REPO = path.resolve(HERE, '..', '..', '..', '..')
const SCRIPT = path.join(REPO, 'scripts', 'usage-summary.mjs')

const us = await serverModule('usage-summary.ts')
const fx = makeFixture()
after(() => fx.cleanup())

const NOW = new Date('2026-11-07T20:00:00Z')
const CFG = path.join(fx.root, '.local', 'usage-panel.json')
const SUM = path.join(fx.root, '.local', 'usage-summary.json')
const DECOY = 'DECOY_MARKER_9f3a'
const NOT_VALID = 'The usage summary is not valid and was ignored.'

const totals = (o = {}) => ({ events: 3, runs: 1, input_tokens: 10, output_tokens: 20, cache_read_tokens: 30, cache_write_tokens: 40, reasoning_tokens: 5, request_multiplier_sum: 1.5, ...o })
const bucket = (o = {}) => ({ label: 'Main thread - gpt-test', kind: 'main', ...totals(), ...o })
const period = () => ({ totals: totals(), buckets: [bucket()] })
function summary(o = {}) {
  return {
    schema_version: 1,
    generated_at: '2026-11-07T19:00:00.000Z',
    source: 'local-copilot-session-store',
    attribution: 'partial',
    periods: { last_24h: period(), last_7d: period(), all_time: period() },
    buckets: [bucket()],
    notes: ['Recorded usage - not live.'],
    github_spend: null,
    github_remaining: null,
    ...o,
  }
}
function reset() {
  fs.rmSync(path.join(fx.root, '.local'), { recursive: true, force: true })
  fs.mkdirSync(path.join(fx.root, '.local'), { recursive: true })
}
function setup(cfg, sum) {
  reset()
  if (cfg !== undefined) fs.writeFileSync(CFG, typeof cfg === 'string' ? cfg : JSON.stringify(cfg))
  if (sum !== undefined) fs.writeFileSync(SUM, typeof sum === 'string' ? sum : JSON.stringify(sum))
  return us.buildUsage(fx.root, NOW)
}
const unavailable = (r) => r.enabled === true && r.available === false

test('disabled when .local is absent, config absent, invalid, or enabled != true', () => {
  fs.rmSync(path.join(fx.root, '.local'), { recursive: true, force: true })
  assert.deepEqual(us.buildUsage(fx.root, NOW), { enabled: false })
  for (const cfg of ['not json', '[]', 'null', '{}', { enabled: 'true' }, { enabled: 1 }, { enabled: false }]) {
    assert.deepEqual(setup(cfg, summary()), { enabled: false }, JSON.stringify(cfg))
  }
})

test('disabled response contains nothing but enabled:false even when a summary exists', () => {
  const r = setup({ enabled: false }, summary({ notes: [DECOY] }))
  assert.equal(JSON.stringify(r), '{"enabled":false}')
})

test('enabled without summary reports unavailable with a fixed reason and no paths', () => {
  const r = setup({ enabled: true })
  assert.ok(unavailable(r))
  assert.notEqual(r.reason, NOT_VALID)
  assert.doesNotMatch(JSON.stringify(r), /[A-Za-z]:\\|tmp-iso|\.local/)
})

test('valid summary returns only whitelisted fields with age and stale flag', () => {
  const r = setup({ enabled: true }, summary())
  assert.equal(r.available, true)
  assert.deepEqual(Object.keys(r).sort(), ['ageSeconds', 'attribution', 'available', 'buckets', 'enabled', 'generatedAt', 'githubRemaining', 'githubSpend', 'notes', 'periods', 'source', 'stale'])
  assert.equal(r.ageSeconds, 3600)
  assert.equal(r.stale, false)
  assert.equal(r.githubSpend, null)
  assert.deepEqual(Object.keys(r.periods.all_time).sort(), ['buckets', 'totals'])
})

test('stale after 24h; slightly-future timestamps clamp, far-future rejected', () => {
  assert.equal(setup({ enabled: true }, summary({ generated_at: '2026-11-06T19:59:00Z' })).stale, true)
  assert.equal(setup({ enabled: true }, summary({ generated_at: '2026-11-07T20:02:00Z' })).ageSeconds, 0)
  assert.ok(unavailable(setup({ enabled: true }, summary({ generated_at: '2026-11-08T20:00:00Z' }))))
})

test('non-whitelisted fields (decoy) never appear in output', () => {
  const s = summary({ decoy: DECOY, message: DECOY, path: 'C:\\x' })
  s.buckets[0].user_message = DECOY
  s.periods.last_7d.extra = { prompt: DECOY }
  s.periods.all_time.totals.summary = DECOY
  const r = setup({ enabled: true }, s)
  assert.equal(r.available, true)
  assert.ok(!JSON.stringify(r).includes(DECOY))
})

test('hostile or invalid content makes the whole summary unavailable', () => {
  const cases = {
    markup_label: (s) => { s.buckets[0].label = '<img src=x onerror=alert(1)>' },
    abs_path_label: (s) => { s.buckets[0].label = 'C:\\Users\\victim\\secret' },
    unix_path_note: (s) => { s.notes = ['see /etc/passwd'] },
    long_label: (s) => { s.buckets[0].label = 'a'.repeat(500) },
    huge_number: (s) => { s.buckets[0].input_tokens = 1e300 },
    unsafe_int: (s) => { s.buckets[0].events = 2 ** 60 },
    negative: (s) => { s.periods.last_24h.totals.output_tokens = -1 },
    fractional: (s) => { s.buckets[0].events = 1.5 },
    string_number: (s) => { s.buckets[0].events = '3' },
    neg_multiplier: (s) => { s.buckets[0].request_multiplier_sum = -2 },
    nan_like: (s) => { s.buckets[0].request_multiplier_sum = null },
    too_many_buckets: (s) => { s.buckets = Array.from({ length: 51 }, bucket) },
    bad_kind: (s) => { s.buckets[0].kind = 'x' },
    bad_schema_version: (s) => { s.schema_version = 2 },
    bad_source: (s) => { s.source = 'other' },
    bad_attribution: (s) => { s.attribution = 'guess' },
    spend_not_null: (s) => { s.github_spend = 12 },
    remaining_not_null: (s) => { s.github_remaining = { a: 1 } },
    missing_period: (s) => { delete s.periods.last_7d },
    too_many_notes: (s) => { s.notes = Array.from({ length: 11 }, () => 'n') },
    bad_date: (s) => { s.generated_at = 'yesterday' },
  }
  for (const [name, mutate] of Object.entries(cases)) {
    const s = summary()
    mutate(s)
    const r = setup({ enabled: true }, s)
    assert.ok(unavailable(r), name)
    assert.equal(r.reason, NOT_VALID, name)
  }
  assert.equal(setup({ enabled: true }, summary({ buckets: Array.from({ length: 50 }, bucket) })).available, true)
})

test('malformed JSON and non-object roots are ignored with the fixed reason', () => {
  for (const text of ['{not json', '[]', '"str"', '']) {
    const r = setup({ enabled: true }, text)
    assert.ok(unavailable(r), text)
    assert.equal(r.reason, NOT_VALID)
    assert.doesNotMatch(JSON.stringify(r), /Unexpected|position|at /)
  }
})

test('oversized file (>64 KB) is rejected with the same "not valid" reason', () => {
  const r = setup({ enabled: true }, summary({ pad: 'x'.repeat(70 * 1024) }))
  assert.ok(unavailable(r))
  assert.equal(r.reason, NOT_VALID)
  fs.writeFileSync(CFG, JSON.stringify({ enabled: true, pad: 'x'.repeat(70 * 1024) }))
  assert.deepEqual(us.buildUsage(fx.root, NOW), { enabled: false })
})

test('symlinked summary or config file is rejected', (t) => {
  reset()
  fs.writeFileSync(path.join(fx.outside, 'real.json'), JSON.stringify(summary()))
  fs.writeFileSync(CFG, JSON.stringify({ enabled: true }))
  if (!tryLink(path.join(fx.outside, 'real.json'), SUM, 'file')) return t.skip('symlink privilege unavailable')
  assert.ok(unavailable(us.buildUsage(fx.root, NOW)))
  fs.rmSync(SUM)
  fs.writeFileSync(path.join(fx.outside, 'cfg.json'), JSON.stringify({ enabled: true }))
  fs.rmSync(CFG)
  tryLink(path.join(fx.outside, 'cfg.json'), CFG, 'file')
  assert.deepEqual(us.buildUsage(fx.root, NOW), { enabled: false })
})

test('junctioned .local directory is rejected', (t) => {
  fs.rmSync(path.join(fx.root, '.local'), { recursive: true, force: true })
  const real = path.join(fx.outside, 'dotlocal')
  fs.mkdirSync(real, { recursive: true })
  fs.writeFileSync(path.join(real, 'usage-panel.json'), JSON.stringify({ enabled: true }))
  fs.writeFileSync(path.join(real, 'usage-summary.json'), JSON.stringify(summary()))
  if (!tryLink(real, path.join(fx.root, '.local'), 'junction')) return t.skip('junction unavailable')
  assert.deepEqual(us.buildUsage(fx.root, NOW), { enabled: false })
  fs.rmSync(path.join(fx.root, '.local'), { recursive: true, force: true })
})

test('hardlinked summary is rejected', (t) => {
  reset()
  fs.writeFileSync(CFG, JSON.stringify({ enabled: true }))
  fs.writeFileSync(SUM, JSON.stringify(summary()))
  try { fs.linkSync(SUM, path.join(fx.outside, 'alias.json')) } catch { return t.skip('hardlink unavailable') }
  assert.ok(unavailable(us.buildUsage(fx.root, NOW)))
})

test('paths are fixed: the API takes no client input', () => {
  assert.deepEqual([...us.USAGE_FILES], ['.local/usage-panel.json', '.local/usage-summary.json'])
  assert.equal(us.buildUsage.length, 1) // (projectRoot, now = default): no path/query parameter
  const src = fs.readFileSync(path.join(SERVER_DIR, 'index.ts'), 'utf-8')
  const m = /app\.get\('\/api\/usage', \(_req, res\) => \{[\s\S]*?\n\}\)/.exec(src)
  assert.ok(m, 'route present')
  assert.doesNotMatch(m[0], /req\.(query|params|body|headers)/)
  assert.match(m[0], /buildUsage\(path\.resolve\(PROJECT\.appDir, '\.\.', '\.\.'\)\)/)
  assert.match(m[0], /status\(500\)\.json\(\{ error: 'usage unavailable' \}\)/)
})

test('guards: dev deny-list blocks .local via /@fs and direct URLs; mutations are 403', async () => {
  const g = await serverModule('request-guard.ts')
  const app = path.resolve(fx.root, 'vendor', 'jarvis')
  const vault = path.join(fx.root, 'demo-vault')
  for (const u of ['/.local/usage-summary.json', '/@fs/' + path.join(fx.root, '.local', 'usage-summary.json').replace(/\\/g, '/'), '/%2e%6cocal/usage-panel.json']) {
    assert.equal(g.isForbiddenDevFsRequest(u, app, vault), true, u)
  }
  const base = { host: '127.0.0.1:3152', origin: undefined, allowedHostHeaders: ['127.0.0.1:3152'], allowedOrigins: [] }
  assert.equal(g.evaluateRequest({ ...base, method: 'GET' }).allow, true)
  assert.equal(g.evaluateRequest({ ...base, method: 'GET', host: 'evil.example' }).allow, false)
  assert.equal(g.evaluateRequest({ ...base, method: 'GET', origin: 'http://evil.example' }).allow, false)
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const v = g.evaluateRequest({ ...base, method: m })
    assert.equal(v.allow, false)
    assert.equal(v.status, 403)
  }
})

function makeStore(name, nModels = 0) {
  const dir = path.join(fx.tmp, name)
  fs.mkdirSync(dir, { recursive: true })
  const dbPath = path.join(dir, 'session-store.db')
  const proj = path.join(fx.tmp, `${name}-project`)
  fs.mkdirSync(proj, { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, summary TEXT);
    CREATE TABLE turns (session_id TEXT, user_message TEXT);
    CREATE TABLE assistant_usage_events (id INTEGER PRIMARY KEY, session_id TEXT, agent_id TEXT, parent_tool_call_id TEXT, model TEXT NOT NULL,
      input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER, request_multiplier REAL,
      prompt_text TEXT, created_at TEXT);`)
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run('s1', proj.toUpperCase(), DECOY)
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run('s2', path.join(fx.tmp, 'other-project'), DECOY)
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run('s3', path.join(proj, 'sub'), DECOY)
  db.prepare('INSERT INTO turns VALUES (?,?)').run('s1', DECOY)
  const ins = db.prepare('INSERT INTO assistant_usage_events (session_id, agent_id, parent_tool_call_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, request_multiplier, prompt_text, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
  const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString()
  if (nModels === 0) {
    ins.run('s1', null, null, 'model-a', 100, 10, 1, 2, 3, 1, DECOY, iso(3600e3))
    ins.run('s1', 'agent-uuid-1', 'tc1', 'model-a', 200, 20, 0, 0, 0, 0.5, DECOY, iso(2 * 24 * 3600e3))
    ins.run('s1', 'agent-uuid-2', 'tc2', 'model-b', 400, 40, 0, 0, 0, 0.5, DECOY, iso(30 * 24 * 3600e3))
    ins.run('s2', null, null, 'model-a', 99999, 99999, 0, 0, 0, 9, DECOY, iso(1000))
    ins.run('s3', null, null, 'model-a', 77777, 77777, 0, 0, 0, 7, DECOY, iso(1000))
  } else {
    for (let i = 0; i < nModels; i++) {
      const model = `model-${String(i).padStart(4, '0')}-${'x'.repeat(25)}`
      ins.run('s1', null, null, model, 1000 + i, 10, 1, 1, 1, 1, DECOY, iso(1000))
      ins.run('s1', `agent-${i}`, 'tc', model, 1000 + i, 10, 1, 1, 1, 1, DECOY, iso(1000))
    }
  }
  db.close()
  return { dir, dbPath, proj, out: path.join(proj, '.local', 'usage-summary.json') }
}
const run = (args, env) => spawnSync(process.execPath, ['--no-warnings', SCRIPT, ...args], { encoding: 'utf-8', env: env ? { ...process.env, ...env } : process.env })

test('collector: reads only aggregates for this exact project cwd, never content, writes compact JSON atomically', () => {
  const st = makeStore('collector')
  const r = run(['--db', st.dbPath, '--project', st.proj, '--out', st.out])
  assert.equal(r.status, 0, r.stderr)
  assert.ok(!(r.stdout + r.stderr).includes(DECOY))
  const text = fs.readFileSync(st.out, 'utf-8')
  assert.ok(!text.includes(DECOY) && !text.includes('agent-uuid') && !text.includes('99999') && !text.includes('77777'))
  assert.equal(text.trimEnd().includes('\n'), false, 'compact JSON')
  assert.deepEqual(fs.readdirSync(path.dirname(st.out)), ['usage-summary.json'])
  const s = JSON.parse(text)
  assert.equal(s.attribution, 'partial')
  assert.equal(s.github_spend, null)
  assert.equal(s.periods.all_time.totals.events, 3)
  assert.equal(s.periods.all_time.totals.runs, 2)
  assert.equal(s.periods.last_7d.totals.events, 2)
  assert.equal(s.periods.last_24h.totals.events, 1)
  assert.equal(s.periods.last_24h.totals.input_tokens, 100)
  assert.deepEqual(s.periods.all_time.buckets.map((b) => b.kind).sort(), ['main', 'subagent', 'subagent'])
  assert.ok(s.buckets.every((b) => /^(Main thread|Subagent runs \(not attributed to a specialist\))/.test(b.label)))
  const v = us.validateSummary(s, new Date())
  assert.ok(v)
  assert.ok(!JSON.stringify(v).includes(DECOY))
})

test('collector: a DB outside the home folder is used but warned about; one inside is not', () => {
  const st = makeStore('collector-warn')
  const outside = run(['--db', st.dbPath, '--project', st.proj, '--out', st.out], { USERPROFILE: fx.home, HOME: fx.home })
  assert.equal(outside.status, 0, outside.stderr)
  assert.match(outside.stderr, /outside your home folder/)
  const inside = run(['--db', st.dbPath, '--project', st.proj, '--out', st.out], { USERPROFILE: fx.tmp, HOME: fx.tmp })
  assert.equal(inside.status, 0, inside.stderr)
  assert.doesNotMatch(inside.stderr, /outside your home folder/)
})

test('collector: many models stay under the 64 KB cap with at most 50 buckets, and the server accepts the file', () => {
  const st = makeStore('collector-many', 300)
  const r = run(['--db', st.dbPath, '--project', st.proj, '--out', st.out])
  assert.equal(r.status, 0, r.stderr)
  const size = fs.statSync(st.out).size
  assert.ok(size < 64 * 1024, `size ${size}`)
  const s = JSON.parse(fs.readFileSync(st.out, 'utf-8'))
  for (const p of Object.values(s.periods)) assert.ok(p.buckets.length <= 50)
  assert.ok(s.buckets.some((b) => b.kind === 'other'))
  assert.equal(s.periods.all_time.totals.events, 600)
  assert.ok(us.validateSummary(s, new Date()))
})

test('collector: --out outside <project>\\.local is refused and nothing is written', () => {
  const st = makeStore('collector-out')
  for (const out of [path.join(st.proj, 'usage-summary.json'), path.join(fx.tmp, 'elsewhere.json'), path.join(st.proj, '.local', '..', 'x.json'), path.join(st.proj, '.local')]) {
    const r = run(['--db', st.dbPath, '--project', st.proj, '--out', out])
    assert.notEqual(r.status, 0, out)
    assert.match(r.stderr, /inside <project>\\\.local/)
    assert.equal(fs.existsSync(out) && fs.statSync(out).isFile(), false, out)
  }
  assert.equal(fs.existsSync(path.join(st.proj, '.local')), false)
})

test('collector: a failed rename leaves no temp file behind', () => {
  const st = makeStore('collector-rename')
  fs.mkdirSync(st.out, { recursive: true }) // a directory at the target makes the rename fail
  const r = run(['--db', st.dbPath, '--project', st.proj, '--out', st.out])
  assert.notEqual(r.status, 0)
  assert.deepEqual(fs.readdirSync(path.dirname(st.out)), ['usage-summary.json'])
  assert.ok(fs.statSync(st.out).isDirectory())
})

test('collector: missing or unreadable store exits non-zero and writes nothing', () => {
  const proj = path.join(fx.tmp, 'none-project')
  fs.mkdirSync(proj, { recursive: true })
  const out = path.join(proj, '.local', 'usage-summary.json')
  const missing = run(['--db', path.join(fx.tmp, 'nope.db'), '--project', proj, '--out', out])
  assert.notEqual(missing.status, 0)
  const bad = path.join(fx.tmp, 'bad.db')
  fs.writeFileSync(bad, 'this is not sqlite')
  const garbage = run(['--db', bad, '--project', proj, '--out', out])
  assert.notEqual(garbage.status, 0)
  assert.equal(fs.existsSync(path.dirname(out)), false)
})
