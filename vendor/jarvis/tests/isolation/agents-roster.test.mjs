// SPDX-License-Identifier: AGPL-3.0-only
// MODIFIED 2026-11-07 for Connected AI Brain Lab project-only isolation (new file; see MODIFICATIONS).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { APP_DIR, makeFixture, serverModule, tryLink } from './_helpers.mjs'

const ro = await serverModule('agents-roster.ts')
const fx = makeFixture()
after(() => fx.cleanup())

const TEAM = `# Squad Team
## Members
| Name | Role | Charter | Status |
|------|------|---------|--------|
| Architect | Coordinator / Architect | \`c\` | Configured; not running |
| Knowledge | Knowledge Architect | \`c\` | Configured; not running |
| Integration | Integration Engineer | \`c\` | Configured; <b onclick=x>not</b> running |
| Security | Security Reviewer | \`c\` | Configured; not running |
| Verification | Verification Engineer | \`c\` | Configured; not running |
`
const IDS = ['architect', 'knowledge', 'integration', 'security', 'verification']
const REG = JSON.stringify({ agents: Object.fromEntries(IDS.map((id) => [id, {
  display_name: id[0].toUpperCase() + id.slice(1), role: 'R ' + id, status: 'active', updated_at: '2026-11-07T20:46:52.064Z', secret_token: 'REGSECRET',
}])) })

function write(root, rel, text) {
  const p = path.join(root, ...rel.split('/'))
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text)
}
function seed(root) {
  write(root, '.squad/team.md', TEAM)
  write(root, '.squad/casting/registry.json', REG)
  write(root, '.squad/identity/now.md', '---\nupdated_at: 2026-11-07T19:36:19.118Z\nfocus_area: Initial setup\n---\nbody')
  for (const id of IDS) {
    write(root, `.squad/agents/${id}/charter.md`, `# ${id}\n## Deliverables\nDeliver ${id} things\n## Model\nCHARTERSECRET\n`)
    write(root, `.squad/agents/${id}/history.md`, 'HISTORYSECRET')
    write(root, `.squad/agents/${id}/prompt.md`, 'PROMPTSECRET')
  }
  write(root, '.squad/config.json', 'CONFIGSECRET')
  write(root, '.squad/decisions.md', 'DECISIONSECRET')
}

test('allow-list is exactly the fixed record files', () => {
  seed(fx.root)
  const allowed = ro.allowListFor(IDS)
  assert.equal(allowed.length, 13)
  assert.ok(allowed.every((f) => (f.startsWith('.squad/') || /^docs\/status\/[a-z]+\.md$/.test(f)) && !f.includes('history') && !f.includes('config.json')))
  assert.deepEqual(allowed.filter((f) => f.startsWith('docs/')), IDS.map((i) => `docs/status/${i}.md`))
  assert.equal(ro.readAllowedRecord(fx.root, 'docs/status/architect.md'), null) // not in the fixed list unless passed
  assert.equal(ro.readAllowedRecord(fx.root, 'docs/status/README.md', allowed), null)
  assert.equal(ro.readAllowedRecord(fx.root, 'docs/status/other.md', allowed), null)
  assert.equal(ro.readAllowedRecord(fx.root, '.squad/agents/architect/history.md', allowed), null)
  assert.equal(ro.readAllowedRecord(fx.root, '.squad/config.json', allowed), null)
  assert.equal(ro.readAllowedRecord(fx.root, '.squad/../vendor/x', allowed), null)
  assert.ok(ro.readAllowedRecord(fx.root, '.squad/team.md'))
})

test('roster exposes five cards with sanitized fields and no raw leakage', () => {
  seed(fx.root)
  const r = ro.buildRoster(fx.root)
  const json = JSON.stringify(r)
  for (const s of ['HISTORYSECRET', 'PROMPTSECRET', 'CONFIGSECRET', 'CHARTERSECRET', 'REGSECRET', 'DECISIONSECRET', '<b', 'onclick']) {
    assert.ok(!json.includes(s), `leaked ${s}`)
  }
  assert.deepEqual(r.agents.map((a) => a.name), ['Architect', 'Knowledge', 'Integration', 'Security', 'Verification'])
  assert.equal(r.agents[0].deliverable, 'Deliver architect things')
  assert.equal(r.agents[0].evidenceRef, '.squad/agents/architect/charter.md')
  assert.equal(r.agents[0].assignedTask, null)
  assert.equal(r.agents[0].statusSource, '.squad/team.md')
  assert.ok(path.isAbsolute(JSON.stringify(r.allowedRecords)) === false)
  assert.ok(!json.includes(fx.root.replace(/\\/g, '\\\\')))
})

test('state labels: never running without evidence; configured vs unknown', () => {
  seed(fx.root)
  const r = ro.buildRoster(fx.root)
  assert.equal(r.liveStatusAvailable, false)
  assert.match(r.limitation, /unavailable/i)
  assert.ok(r.agents.every((a) => a.state === 'configured'))
  assert.equal(ro.deriveState({ configured: true, savedUpdate: true, liveObserved: false }), 'last_reported')
  assert.equal(ro.deriveState({ configured: true, savedUpdate: false, liveObserved: false }), 'configured')
  assert.equal(ro.deriveState({ configured: false, savedUpdate: false, liveObserved: false }), 'unknown')
  assert.equal(ro.deriveState({ configured: true, savedUpdate: true, liveObserved: true }), 'running')
})

test('missing records yield an empty roster with a reason, no invented agents', () => {
  const empty = fs.mkdtempSync(path.join(fx.tmp, 'empty-'))
  const r = ro.buildRoster(empty)
  assert.equal(r.agents.length, 0)
  assert.match(r.rosterReason, /^No roster found/)
  assert.equal(r.kanban.columns.reduce((n, c) => n + c.total, 0), 0)
})

test('oversized and non-file records are rejected', () => {
  seed(fx.root)
  write(fx.root, '.squad/team.md', 'x'.repeat(70 * 1024))
  assert.equal(ro.readAllowedRecord(fx.root, '.squad/team.md'), null)
  fs.rmSync(path.join(fx.root, '.squad', 'team.md'))
  fs.mkdirSync(path.join(fx.root, '.squad', 'team.md'))
  assert.equal(ro.readAllowedRecord(fx.root, '.squad/team.md'), null)
})

test('junction/symlink records and directories are rejected', (t) => {
  const root = fs.mkdtempSync(path.join(fx.tmp, 'link-'))
  seed(root)
  fs.rmSync(path.join(root, '.squad', 'identity'), { recursive: true })
  fs.mkdirSync(path.join(fx.outside, 'identity'), { recursive: true })
  fs.writeFileSync(path.join(fx.outside, 'identity', 'now.md'), '---\nfocus_area: OUTSIDE\n---')
  if (!tryLink(path.join(fx.outside, 'identity'), path.join(root, '.squad', 'identity'), 'junction')) {
    return t.skip('cannot create junction')
  }
  assert.equal(ro.readAllowedRecord(root, '.squad/identity/now.md'), null)
  assert.equal(ro.buildRoster(root).projectFocus, null)
})

const entry = (o = {}) => {
  const f = { Agent: 'integration', 'Task ID': 'T-1', 'Task title': 'Do thing', Status: 'started', Reported: '2026-11-07T17:00:00-05:00', Blocker: 'none', 'Next action': 'next', Deliverable: 'docs/a.md', Evidence: 'docs/b.md', Kind: 'live_report', ...o }
  return '## Update\n' + Object.entries(f).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n'
}

test('status parser: accepts valid, skips malformed, no leakage of other text', () => {
  const text = 'FREEPROSE_SECRET\n' + entry() + 'STRAY_SECRET line\n' + entry({ Status: 'running' }) + entry({ 'Task ID': undefined }) +
    entry({ Agent: 'security' }) + entry({ Reported: 'yesterday' }) + entry({ Reported: 'unknown' }) + entry({ Kind: 'x' }) +
    entry({ 'Task ID': 'T-2', 'Task title': '<b onclick=x>Bold</b> `t`', Evidence: 'E'.repeat(700) })
  const p = ro.parseStatusRecord(text, 'integration')
  assert.equal(p.totalValid, 2)
  assert.equal(p.skipped, 6)
  const json = JSON.stringify(p)
  assert.ok(!json.includes('SECRET') && !json.includes('onclick') && !json.includes('<b'))
  const t2 = p.entries.find((e) => e.taskId === 'T-2')
  assert.equal(t2.taskTitle, 'Bold `t`')
  assert.equal(t2.evidence.length, 600)
  assert.equal(p.entries.find((e) => e.taskId === 'T-1').blocker, null)
  assert.deepEqual(ro.parseStatusRecord('garbage \u0000 no entries', 'integration'), { entries: [], skipped: 0, totalValid: 0 })
})

test('status parser: ordering, unknown time only for retrospective, caps', () => {
  const text = entry({ 'Task ID': 'A', Reported: '2026-11-07T10:00:00-05:00' }) +
    entry({ 'Task ID': 'R1', Kind: 'retrospective', Reported: 'unknown' }) +
    entry({ 'Task ID': 'B', Reported: '2026-11-07T12:00:00-05:00' }) +
    entry({ 'Task ID': 'R2', Kind: 'retrospective', Reported: 'unknown' }) +
    entry({ 'Task ID': 'BAD', Reported: 'unknown' })
  const p = ro.parseStatusRecord(text, 'integration')
  assert.deepEqual(p.entries.map((e) => e.taskId), ['B', 'A', 'R2', 'R1'])
  assert.equal(p.entries[2].reported, null)
  assert.equal(p.skipped, 1)
  const many = Array.from({ length: 50 }, (_, i) => entry({ 'Task ID': `N${i}`, Reported: `2026-11-07T${String(i % 24).padStart(2, '0')}:00:00Z` })).join('')
  const q = ro.parseStatusRecord(many, 'integration', new Date('2026-12-01T00:00:00Z'))
  assert.equal(q.entries.length, 20)
  assert.equal(q.totalValid, 50)
})

test('roster: state rules, reported vs fileModified, retrospective, never running', () => {
  const root = fs.mkdtempSync(path.join(fx.tmp, 'st-'))
  seed(root)
  write(root, 'docs/status/integration.md', entry({ 'Task ID': 'LIVE', Status: 'started' }) + entry({ 'Task ID': 'OLD', Kind: 'retrospective', Reported: 'unknown', Status: 'completed' }))
  write(root, 'docs/status/security.md', '## Update\nonly junk\n')
  write(root, 'docs/status/verification.md', '# empty template\n')
  const old = new Date('2020-01-01T00:00:00Z')
  fs.utimesSync(path.join(root, 'docs/status/integration.md'), old, old)
  const r = ro.buildRoster(root)
  const by = Object.fromEntries(r.agents.map((a) => [a.id, a]))
  assert.equal(by.integration.state, 'last_reported')
  assert.equal(by.integration.assignedTask, 'LIVE: Do thing')
  assert.equal(by.integration.latestStatus, 'started')
  assert.equal(by.integration.reportedAt, '2026-11-07T22:00:00.000Z')
  assert.equal(by.integration.reportedAtSource, 'record')
  assert.equal(by.integration.fileModified, old.toISOString())
  assert.equal(by.integration.fileModifiedSource, 'docs/status/integration.md')
  assert.equal(by.integration.deliverable, 'docs/a.md')
  assert.equal(by.integration.nextAction, 'next')
  assert.equal(by.integration.recentUpdates.length, 2)
  assert.equal(by.integration.recentUpdates[1].kind, 'retrospective')
  assert.equal(by.security.state, 'unknown')
  assert.equal(by.security.skippedEntries, 1)
  assert.equal(by.verification.state, 'configured')
  assert.equal(by.architect.state, 'configured')
  assert.ok(r.agents.every((a) => a.state !== 'running'))
  assert.equal(r.liveStatusAvailable, false)
})

test('retrospective-only record: latest is retrospective with unknown reported time', () => {
  const root = fs.mkdtempSync(path.join(fx.tmp, 'retro-'))
  seed(root)
  write(root, 'docs/status/knowledge.md', entry({ Agent: 'knowledge', Kind: 'retrospective', Reported: 'unknown', Status: 'completed' }))
  const a = ro.buildRoster(root).agents.find((x) => x.id === 'knowledge')
  assert.equal(a.state, 'last_reported')
  assert.equal(a.latestKind, 'retrospective')
  assert.equal(a.reportedAt, null)
  assert.ok(a.fileModified)
})

test('status record junction/oversize are rejected', (t) => {
  const root = fs.mkdtempSync(path.join(fx.tmp, 'stl-'))
  seed(root)
  write(root, 'docs/status/integration.md', 'x'.repeat(70 * 1024))
  assert.equal(ro.buildRoster(root).agents.find((a) => a.id === 'integration').state, 'unknown')
  fs.rmSync(path.join(root, 'docs'), { recursive: true })
  fs.mkdirSync(path.join(fx.outside, 'status'), { recursive: true })
  fs.writeFileSync(path.join(fx.outside, 'status', 'integration.md'), entry({ 'Task ID': 'OUTSIDE' }))
  fs.mkdirSync(path.join(root, 'docs'))
  if (!tryLink(path.join(fx.outside, 'status'), path.join(root, 'docs', 'status'), 'junction')) return t.skip('cannot create junction')
  assert.equal(ro.readAllowedRecord(root, 'docs/status/integration.md'), null)
  assert.ok(!JSON.stringify(ro.buildRoster(root)).includes('OUTSIDE'))
})

test('sanitizeText strips markup/control chars and caps length', () => {
  assert.equal(ro.sanitizeText('<img src=x onerror=1>hi\u0000 there'), 'hi there')
  assert.ok(ro.sanitizeText('a'.repeat(1000)).length <= 200)
  assert.equal(ro.sanitizeText(42), null)
})

function req(port, method, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      let b = ''
      res.on('data', (c) => (b += c))
      res.on('end', () => resolve({ status: res.statusCode, body: b }))
    })
    r.on('error', reject)
    r.end()
  })
}

test('endpoint: GET ok, bad Host/Origin 403, mutations 403', async (t) => {
  const apiPort = 3122
  const env = {
    ...process.env, JARVIS_PROJECT_MODE: '1',
    JARVIS_PROJECT_VAULT: path.resolve(APP_DIR, '..', '..', 'demo-vault'),
    JARVIS_PROJECT_API_PORT: String(apiPort), JARVIS_PROJECT_UI_PORT: '5293',
  }
  const child = spawn(process.execPath, [path.join(APP_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], { cwd: APP_DIR, env, stdio: 'ignore' })
  try {
    let ok = null
    for (let i = 0; i < 60 && !ok; i++) {
      await new Promise((r) => setTimeout(r, 500))
      try { ok = await req(apiPort, 'GET', '/api/agents', { Host: `127.0.0.1:${apiPort}` }) } catch { /* not up yet */ }
    }
    assert.ok(ok, 'server did not start')
    assert.equal(ok.status, 200)
    const body = JSON.parse(ok.body)
    assert.equal(body.liveStatusAvailable, false)
    const teamFile = path.resolve(APP_DIR, '..', '..', '.squad', 'team.md')
    const expected = ro.parseTeamRoster(fs.existsSync(teamFile) ? fs.readFileSync(teamFile, 'utf-8') : null).members.length
    assert.equal(body.agents.length, expected)
    assert.ok(body.agents.every((a) => a.state !== 'running'))
    assert.equal((await req(apiPort, 'GET', '/api/agents', { Host: 'evil.example:3122' })).status, 403)
    assert.equal((await req(apiPort, 'GET', '/api/agents', { Host: `127.0.0.1:${apiPort}`, Origin: 'http://evil.example' })).status, 403)
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      assert.equal((await req(apiPort, m, '/api/agents', { Host: `127.0.0.1:${apiPort}` })).status, 403, m)
    }
  } finally {
    child.kill()
  }
})

test('future Reported time (beyond 5 min skew) is skipped and cannot be latest', () => {
  const now = new Date('2026-11-07T17:00:00-05:00')
  const text = entry({ 'Task ID': 'OLD', Reported: '2026-11-07T16:00:00-05:00' }) +
    entry({ 'Task ID': 'FORGED', Reported: '2099-01-01T00:00:00Z' }) +
    entry({ 'Task ID': 'SKEWOK', Reported: '2026-11-07T17:03:00-05:00' }) +
    entry({ 'Task ID': 'TOOFAR', Reported: '2026-11-07T17:06:00-05:00' })
  const p = ro.parseStatusRecord(text, 'integration', now)
  assert.deepEqual(p.entries.map((e) => e.taskId), ['SKEWOK', 'OLD'])
  assert.equal(p.skipped, 2)
})

test('sanitizeText keeps identifiers with underscores/asterisks', () => {
  assert.equal(ro.sanitizeText('set JARVIS_PROJECT_MODE=1 and **bold** `x`'), 'set JARVIS_PROJECT_MODE=1 and **bold** `x`')
})

test('sanitizeText strips zero-width and bidi controls', () => {
  assert.equal(ro.sanitizeText('a\u200Bb\u200Ec\u200Fd\u061Ce\u2060f\uFEFFg\u202Eh'), 'a b c d e f g h')
})

test('retrospective label is driven by Kind only', () => {
  const p = ro.parseStatusRecord(entry({ 'Task ID': 'K1', Kind: 'retrospective', Reported: '2026-11-07T10:00:00-05:00' }) +
    entry({ 'Task ID': 'K2', Kind: 'live_report', Reported: 'unknown' }), 'integration', new Date('2026-12-01T00:00:00Z'))
  assert.equal(p.entries.length, 1)
  assert.equal(p.entries[0].kind, 'retrospective')
  assert.notEqual(p.entries[0].reported, null)
  assert.equal(p.skipped, 1)
})
