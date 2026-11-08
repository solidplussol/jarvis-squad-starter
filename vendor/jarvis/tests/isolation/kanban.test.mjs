// SPDX-License-Identifier: AGPL-3.0-only
// MODIFIED 2026-11-07 for Connected AI Brain Lab project-only isolation (new file; see MODIFICATIONS).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeFixture, serverModule } from './_helpers.mjs'

const ro = await serverModule('agents-roster.ts')
const fx = makeFixture()
after(() => fx.cleanup())

const NOW = new Date('2026-11-07T20:00:00Z')
const IDS = ['architect', 'knowledge', 'integration', 'security', 'verification']
fs.mkdirSync(path.join(fx.root, '.squad'), { recursive: true })
fs.writeFileSync(path.join(fx.root, '.squad', 'team.md'),
  '## Members\n| Name | Role | Charter | Status |\n|---|---|---|---|\n' + IDS.map((i) => `| ${i[0].toUpperCase() + i.slice(1)} | R | c | Configured |`).join('\n') + '\n')
function entry(agent, id, status, kind, reported, extra = '') {
  return `## Update\nAgent: ${agent}\nTask ID: ${id}\nTask Title: Title ${id}\nStatus: ${status}\nReported: ${reported}\nKind: ${kind}\n${extra}\n`
}
function writeStatus(agent, text) {
  const p = path.join(fx.root, 'docs', 'status', `${agent}.md`)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, '# rec\n\n' + text)
}
const col = (b, name) => b.columns.find((c) => c.name === name)

test('grouping by agent+taskId, latest entry decides column, column mapping and order', () => {
  writeStatus('architect',
    entry('architect', 'T1', 'started', 'live_report', '2026-11-07T10:00:00Z') +
    entry('architect', 'T1', 'completed', 'live_report', '2026-11-07T11:00:00Z', 'Deliverable: doc.md\nEvidence: docs/x.md') +
    entry('architect', 'T2', 'blocked', 'live_report', '2026-11-07T12:00:00Z', 'Blocker: waiting\nNext Action: ask') +
    entry('architect', 'T3', 'handed_off', 'live_report', '2026-11-07T09:00:00Z') +
    entry('architect', 'T4', 'started', 'live_report', '2026-11-07T08:00:00Z'))
  // Same task ID under another agent is a different task.
  writeStatus('security', entry('security', 'T1', 'started', 'live_report', '2026-11-07T13:00:00Z'))
  const r = ro.buildRoster(fx.root, NOW)
  const b = r.kanban
  assert.deepEqual(b.columns.map((c) => c.name), ['Blocked', 'Handed off', 'In progress (last reported)', 'Completed', 'Recorded retrospective'])
  assert.deepEqual(col(b, 'Completed').tasks.map((t) => `${t.agent}/${t.taskId}`), ['architect/T1'])
  assert.equal(col(b, 'Completed').tasks[0].deliverable, 'doc.md')
  assert.equal(col(b, 'Completed').tasks[0].reportedSource, 'docs/status/architect.md')
  assert.equal(col(b, 'Blocked').tasks[0].blocker, 'waiting')
  assert.equal(col(b, 'Handed off').tasks[0].taskId, 'T3')
  assert.deepEqual(col(b, 'In progress (last reported)').tasks.map((t) => `${t.agent}/${t.taskId}`), ['security/T1', 'architect/T4'])
  assert.equal(r.allowedRecords.length, 13)
  assert.equal(r.agents.find((a) => a.id === 'architect').recentUpdates.length, 5)
})

test('retrospectives are separate; future-dated entries excluded; never "running"', () => {
  writeStatus('knowledge',
    entry('knowledge', 'R1', 'completed', 'retrospective', 'unknown') +
    entry('knowledge', 'L1', 'completed', 'live_report', '2026-11-07T10:00:00Z') +
    entry('knowledge', 'F1', 'completed', 'live_report', '2027-01-01T00:00:00Z') +
    entry('knowledge', 'L1', 'completed', 'live_report', '2030-01-01T00:00:00Z', 'Next Action: forged'))
  const b = ro.buildRoster(fx.root, NOW).kanban
  assert.deepEqual(col(b, 'Recorded retrospective').tasks.map((t) => t.taskId), ['R1'])
  assert.ok(col(b, 'Completed').tasks.every((t) => t.kind === 'live_report'))
  const k = col(b, 'Completed').tasks.filter((t) => t.agent === 'knowledge')
  assert.deepEqual(k.map((t) => t.taskId), ['L1'])
  assert.equal(k[0].nextAction, null)
  assert.ok(!JSON.stringify(b).toLowerCase().includes('running'))
})

test('per-column cap and field length caps', () => {
  for (const agent of IDS) {
    let text = ''
    for (let i = 0; i < 30; i++) {
      text += entry(agent, `C${i}`, 'blocked', 'live_report', `2026-11-07T${String(i % 20).padStart(2, '0')}:00:00Z`, 'Blocker: ' + 'x'.repeat(1000))
    }
    writeStatus(agent, text)
  }
  const c = col(ro.buildRoster(fx.root, NOW).kanban, 'Blocked')
  assert.equal(c.total, 5 * ro.MAX_ENTRIES_PER_AGENT)
  assert.equal(c.tasks.length, ro.MAX_TASKS_PER_COLUMN)
  assert.ok(c.tasks.every((t) => t.blocker.length <= 300))
  assert.ok(c.tasks.every((t) => t.blocker.length > 200))
})
