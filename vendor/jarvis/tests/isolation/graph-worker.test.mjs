// SPDX-License-Identifier: AGPL-3.0-only
// MODIFIED 2026-11-07 for Connected AI Brain Lab project-only isolation (new file; see MODIFICATIONS).
//
// Regression: the graph worker must load in a bare worker thread (as under tsx,
// where relative specifiers are not remapped) and build the graph in project mode.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { makeFixture, SERVER_DIR } from './_helpers.mjs'

const workerFile = path.join(SERVER_DIR, 'graph-worker.ts')

test('graph-worker.ts has no static relative value imports (worker loaders do not remap them)', () => {
  const src = fs.readFileSync(workerFile, 'utf-8')
  const bad = [...src.matchAll(/^import\s+(?!type\b)[^'"\n]*from\s+['"](\.[^'"]+)['"]/gm)].map((m) => m[1])
  assert.deepEqual(bad, [])
})

test('graph worker runs in a plain worker thread and builds the demo graph in project mode', async () => {
  const fx = makeFixture()
  try {
    const result = await new Promise((resolve, reject) => {
      const w = new Worker(workerFile, { workerData: { vaultPath: fx.vault, projectMode: true } })
      const timer = setTimeout(() => { w.terminate(); reject(new Error('worker timeout')) }, 20000)
      w.on('message', (m) => { if (m.type === 'done') { clearTimeout(timer); resolve(m.graph); w.terminate() } })
      w.on('error', (e) => { clearTimeout(timer); reject(e) })
      w.on('exit', (c) => { if (c !== 0) { clearTimeout(timer); reject(new Error('worker exit ' + c)) } })
    })
    const ids = result.nodes.map((n) => n.path).sort()
    assert.deepEqual(ids, ['Home.md', 'notes/deep/Deep.md'])
    assert.equal(result.links.length, 1)
  } finally {
    fx.cleanup()
  }
})
