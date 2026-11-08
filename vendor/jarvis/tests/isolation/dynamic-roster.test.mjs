// SPDX-License-Identifier: AGPL-3.0-only
// MODIFIED 2026-11-07 for Connected AI Brain Lab project-only isolation (new file; see MODIFICATIONS).
// Dynamic roster: members come from .squad/team.md, ids are strictly validated, reads stay allow-listed.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeFixture, serverModule, tryLink } from './_helpers.mjs'

const ro = await serverModule('agents-roster.ts')
const fx = makeFixture()
after(() => fx.cleanup())

let n = 0
const newRoot = () => {
  const p = path.join(fx.tmp, `r${n++}`)
  fs.mkdirSync(p, { recursive: true })
  return p
}
function write(root, rel, text) {
  const p = path.join(root, ...rel.split('/'))
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text)
}
const team = (...names) => '# Team\n## Members\n| Name | Role | Charter | Status |\n|------|------|---------|--------|\n' +
  names.map((x) => `| ${x} | Role of ${x} | \`c\` | Configured; not running |`).join('\n') + '\n## Other\n| Name | Role |\n|--|--|\n| Intruder | x |\n'
const entry = (agent, id = 'T-1') => `## Update\nAgent: ${agent}\nTask ID: ${id}\nTask Title: Work ${id}\nStatus: started\nReported: 2026-11-07T10:00:00Z\nKind: live_report\n`
const NOW = new Date('2026-11-07T20:00:00Z')

test('normal roster with names other than the five specialists', () => {
  const root = newRoot()
  write(root, '.squad/team.md', team('Ada', 'Grace Hopper', 'linus'))
  write(root, 'docs/status/ada.md', entry('ada'))
  write(root, 'docs/status/grace-hopper.md', entry('grace-hopper'))
  const r = ro.buildRoster(root, NOW)
  assert.deepEqual(r.agents.map((a) => a.id), ['ada', 'grace-hopper', 'linus'])
  assert.equal(r.rosterReason, null)
  assert.equal(r.rosterSource, '.squad/team.md')
  assert.equal(r.liveStatusAvailable, false)
  assert.deepEqual(r.agents.map((a) => a.state), ['last_reported', 'last_reported', 'configured'])
  assert.deepEqual(r.kanban.columns.find((c) => c.name === 'In progress (last reported)').tasks.map((t) => t.agent).sort(), ['ada', 'grace-hopper'])
  assert.ok(!JSON.stringify(r).includes('Intruder'))
  assert.ok(!r.agents.some((a) => ['architect', 'security', 'scribe'].includes(a.id)))
  assert.deepEqual(r.allowedRecords.filter((f) => !f.startsWith('.squad/agents/')),
    ['.squad/team.md', '.squad/casting/registry.json', '.squad/identity/now.md', 'docs/status/ada.md', 'docs/status/grace-hopper.md', 'docs/status/linus.md'])
})

test('status entry whose Agent does not match its file is skipped', () => {
  const root = newRoot()
  write(root, '.squad/team.md', team('Ada', 'Bob'))
  write(root, 'docs/status/ada.md', entry('bob'))
  const a = ro.buildRoster(root, NOW).agents[0]
  assert.equal(a.state, 'unknown')
  assert.equal(a.recentUpdates.length, 0)
})

test('empty team.md, missing section and malformed table give an empty roster with a reason', () => {
  for (const text of ['', '# Team\nno members', '## Members\n| Ada | x |\n| Bob | y |\n', '## Members\njust prose', '## Members\n| Role | Status |\n|--|--|\n| a | b |\n']) {
    const root = newRoot()
    write(root, '.squad/team.md', text)
    write(root, 'docs/status/ada.md', entry('ada'))
    const r = ro.buildRoster(root, NOW)
    assert.equal(r.agents.length, 0, text)
    assert.match(r.rosterReason, /^No roster found/)
    assert.equal(r.kanban.columns.reduce((s, c) => s + c.total, 0), 0)
    assert.deepEqual(r.allowedRecords, ['.squad/team.md', '.squad/casting/registry.json', '.squad/identity/now.md'])
  }
})

test('tolerates formatting variation (extra columns, bold, spacing, CRLF, no outer pipes)', () => {
  const root = newRoot()
  write(root, '.squad/team.md', '## Members (2)\r\nStatus | **Name** | Notes | Role\r\n:--|:--|--|--\r\nok | **Ada** | n | Lead\r\nok |  Bob  | n | Dev\r\n')
  const r = ro.buildRoster(root, NOW)
  assert.deepEqual(r.agents.map((a) => [a.id, a.role]), [['ada', 'Lead'], ['bob', 'Dev']])
})

test('retired members (registry) are excluded and counted; registry cannot add members', () => {
  const root = newRoot()
  write(root, '.squad/team.md', team('Ada', 'Bob'))
  write(root, '.squad/casting/registry.json', JSON.stringify({ agents: {
    ada: { display_name: 'Ada', status: 'active' }, bob: { display_name: 'Bob', status: 'retired' }, ghost: { display_name: 'Ghost', status: 'active' },
  } }))
  const r = ro.buildRoster(root, NOW)
  assert.deepEqual(r.agents.map((a) => a.id), ['ada'])
  assert.equal(r.skippedCount, 1)
  assert.ok(!r.allowedRecords.some((f) => f.includes('bob') || f.includes('ghost')))
})

test('all members retired gives an empty roster with a reason', () => {
  const root = newRoot()
  write(root, '.squad/team.md', team('Ada'))
  write(root, '.squad/casting/registry.json', JSON.stringify({ agents: { ada: { status: 'retired' } } }))
  const r = ro.buildRoster(root, NOW)
  assert.equal(r.agents.length, 0)
  assert.match(r.rosterReason, /^No roster found/)
})

test('built-in support agents appear only when listed in the Members table', () => {
  const root = newRoot()
  write(root, '.squad/team.md', team('Ada') + '## Built-in Support Agents\n| Name | Role | Charter | Status |\n|--|--|--|--|\n| Scribe | s | c | dormant |\n')
  assert.deepEqual(ro.buildRoster(root, NOW).agents.map((a) => a.id), ['ada'])
  write(root, '.squad/team.md', team('Ada', 'Fact Checker', 'Scribe'))
  assert.deepEqual(ro.buildRoster(root, NOW).agents.map((a) => a.id), ['ada', 'fact-checker', 'scribe'])
})

const BAD = ['..\\x', '../x', 'a/b', 'a\\b', 'C:', 'C:\\x', 'con', 'NUL', 'com1', 'aux', 'name.', 'a.b', 'name ', '-lead', '.hidden', '', 'a'.repeat(41),
  '\u212a', 'ınstall', 'ａdmin', 'Ad\u200bmin', 'caf\u00e9', 'x:y', 'x\u0000y', '~1', 'a\u202eb']

test('traversal, reserved, trailing-dot and unicode-lookalike names are rejected', () => {
  for (const b of BAD) assert.equal(ro.normalizeMemberId(b), null, JSON.stringify(b))
  assert.equal(ro.normalizeMemberId('Grace Hopper'), 'grace-hopper')
  assert.equal(ro.normalizeMemberId('a'.repeat(40)), 'a'.repeat(40))
  assert.throws(() => ro.statusFile('..'))
  assert.throws(() => ro.charterFile('a/b'))
  const root = newRoot()
  const rows = BAD.filter((b) => !b.includes('\u0000') && b !== '' && b !== 'name ')
  write(root, '.squad/team.md', team('Ada', ...rows))
  write(root, 'x.md', 'X'); write(root, 'docs/status/x.md', entry('x'))
  const r = ro.buildRoster(root, NOW)
  assert.deepEqual(r.agents.map((a) => a.id), ['ada'])
  assert.ok(r.skippedCount >= rows.length - 1)
  const json = JSON.stringify(r)
  for (const b of rows) if (b.length > 3) assert.ok(!json.includes(b.trim()), `echoed ${JSON.stringify(b)}`)
  assert.ok(r.allowedRecords.every((f) => !f.includes('..') && !f.includes('\\') && !f.includes(':')))
})

test('more than 20 members: first 20 kept, rest counted', () => {
  const root = newRoot()
  write(root, '.squad/team.md', team(...Array.from({ length: 25 }, (_, i) => `m${i}`)))
  const r = ro.buildRoster(root, NOW)
  assert.equal(r.agents.length, 20)
  assert.equal(r.skippedCount, 5)
  assert.equal(r.allowedRecords.length, 3 + 40)
})

test('member with no status file is configured, not unknown or running', () => {
  const root = newRoot()
  write(root, '.squad/team.md', team('Ada'))
  const a = ro.buildRoster(root, NOW).agents[0]
  assert.equal(a.state, 'configured')
  assert.equal(a.assignedTask, null)
})

test('oversized status record is rejected (unknown)', () => {
  const root = newRoot()
  write(root, '.squad/team.md', team('Ada'))
  write(root, 'docs/status/ada.md', entry('ada') + 'x'.repeat(70 * 1024))
  assert.equal(ro.buildRoster(root, NOW).agents[0].state, 'unknown')
})

test('junction/symlink charter directory is not followed', (t) => {
  const root = newRoot()
  write(root, '.squad/team.md', team('Ada'))
  fs.mkdirSync(path.join(root, '.squad', 'agents'), { recursive: true })
  fs.mkdirSync(path.join(fx.outside, 'ada'), { recursive: true })
  fs.writeFileSync(path.join(fx.outside, 'ada', 'charter.md'), '## Deliverables\nOUTSIDE_CHARTER_MARKER\n')
  if (!tryLink(path.join(fx.outside, 'ada'), path.join(root, '.squad', 'agents', 'ada'), 'junction')) return t.skip('cannot create junction (no privilege)')
  const r = ro.buildRoster(root, NOW)
  assert.ok(!JSON.stringify(r).includes('OUTSIDE_CHARTER_MARKER'))
  assert.equal(r.agents[0].deliverable, null)
})

test('junction/symlink status file directory is not followed', (t) => {
  const root = newRoot()
  write(root, '.squad/team.md', team('Ada'))
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
  fs.mkdirSync(path.join(fx.outside, 'st'), { recursive: true })
  fs.writeFileSync(path.join(fx.outside, 'st', 'ada.md'), entry('ada', 'OUTSIDE_STATUS_MARKER'))
  if (!tryLink(path.join(fx.outside, 'st'), path.join(root, 'docs', 'status'), 'junction')) return t.skip('cannot create junction (no privilege)')
  const r = ro.buildRoster(root, NOW)
  assert.ok(!JSON.stringify(r).includes('OUTSIDE_STATUS_MARKER'))
})

test('files outside the allow-list are never read or surfaced', () => {
  const root = newRoot()
  write(root, '.squad/team.md', team('Ada'))
  write(root, '.squad/agents/ada/charter.md', '## Deliverables\nShip ada\n## Model\nCHARTER_SECRET\n')
  const decoys = ['.squad/agents/ada/history.md', '.squad/agents/ada/prompt.md', '.squad/decisions.md', '.squad/decisions/inbox/x.md', '.squad/memory/m.md',
    '.squad/config.json', '.squad/templates/spawn.md', '.env', 'docs/status/stranger.md', 'docs/status/README.md', '.squad/agents/stranger/charter.md']
  for (const d of decoys) write(root, d, 'DECOY_MARKER ' + entry('stranger'))
  const r = ro.buildRoster(root, NOW)
  const json = JSON.stringify(r)
  assert.ok(!json.includes('DECOY_MARKER') && !json.includes('stranger') && !json.includes('CHARTER_SECRET'))
  assert.equal(r.agents[0].deliverable, 'Ship ada')
  for (const d of decoys) assert.equal(ro.readAllowedRecord(root, d, r.allowedRecords), null, d)
})

test('response never exposes absolute paths', () => {
  const root = newRoot()
  write(root, '.squad/team.md', team('Ada'))
  assert.ok(!JSON.stringify(ro.buildRoster(root, NOW)).toLowerCase().includes(root.toLowerCase().replace(/\\/g, '\\\\')))
})
test('names are validated on the raw string: a_b and reserved readme are rejected', () => {
  const root = newRoot()
  write(root, '.squad/team.md', team('a_b', 'readme', 'README', 'ok-one'))
  const r = ro.buildRoster(root, NOW)
  assert.deepEqual(r.agents.map((a) => a.id), ['ok-one'])
  assert.equal(r.skippedCount, 3)
  assert.equal(ro.normalizeMemberId('readme'), null)
  assert.equal(ro.normalizeMemberId('a_b'), null)
})

test('a hard-linked record file is not read', (t) => {
  const root = newRoot()
  write(root, '.squad/team.md', team('ada'))
  const link = path.join(root, 'alias.md')
  try { fs.linkSync(path.join(root, '.squad', 'team.md'), link) } catch { return t.skip('cannot create hardlink') }
  assert.equal(ro.readAllowedRecord(root, '.squad/team.md'), null)
  fs.unlinkSync(link)
  assert.ok(ro.readAllowedRecord(root, '.squad/team.md'))
})
