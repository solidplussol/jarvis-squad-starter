// SPDX-License-Identifier: AGPL-3.0-only
// MODIFIED 2026-11-07 for Connected AI Brain Lab project-only isolation (new file; see MODIFICATIONS).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeFixture, serverModule, tryLink } from './_helpers.mjs'

const cp = await serverModule('content-path.ts')

function expectDenied(fn, label) {
  assert.throws(fn, (e) => e instanceof cp.ContentPathError, `${label} must be rejected with ContentPathError`)
}

test('legitimate nested .md is readable; forward and back slashes both work', () => {
  const fx = makeFixture()
  try {
    assert.match(cp.readNoteSafe(fx.vault, 'Home.md').content, /# Home/)
    const nested = cp.readNoteSafe(fx.vault, 'notes/deep/Deep.md')
    assert.equal(nested.path, 'notes/deep/Deep.md')
    assert.match(nested.content, /# Deep/)
    assert.match(cp.readNoteSafe(fx.vault, 'notes\\deep\\Deep.md').content, /# Deep/)
  } finally {
    fx.cleanup()
  }
})

test('traversal, absolute, UNC, drive, NUL, ADS, device names, encoded and odd names are rejected', () => {
  const fx = makeFixture()
  try {
    const bad = [
      '../outside/secret.md',
      'notes/../../outside/secret.md',
      'notes/..\\..\\outside\\secret.md',
      '..',
      fx.outside + path.sep + 'secret.md',
      '/etc/passwd.md',
      '\\Windows\\win.md',
      '\\\\server\\share\\a.md',
      '//server/share/a.md',
      'C:\\Windows\\win.md',
      'C:win.md',
      'Home.md\0.txt',
      'Home.md:stream',
      'Home.md::$DATA',
      'notes/Home.md:evil.md',
      'con.md',
      'notes/NUL.md',
      'aux.txt.md',
      'COM1.md',
      'lpt9.md',
      'CONIN$.md',
      'Home.md.',
      'Home.md ',
      'notes /Deep.md',
      '%2e%2e/outside/secret.md',
      'notes/%2E%2E/%2E%2E/outside/secret.md',
      'notes%2fdeep%2fDeep.md',
      'notes//deep/Deep.md',
      '.obsidian/app.md',
      'notes/.hidden.md',
      'notes/readme.txt',
      'notes/deep',
      'Home',
      '',
      undefined,
      null,
      ['Home.md'],
      'HOME~1.md',
      'a'.repeat(2000) + '.md',
      'bad<name>.md',
      'bad?.md',
    ]
    for (const p of bad) expectDenied(() => cp.readNoteSafe(fx.vault, p), JSON.stringify(p))
  } finally {
    fx.cleanup()
  }
})

test('sibling-prefix directory is not treated as inside the vault', () => {
  const fx = makeFixture()
  try {
    const evil = fx.vault + '-evil'
    fs.mkdirSync(evil)
    fs.writeFileSync(path.join(evil, 'x.md'), 'EVIL')
    expectDenied(() => cp.readNoteSafe(fx.vault, '../demo-vault-evil/x.md'), 'sibling-prefix traversal')
    expectDenied(() => cp.verifyNotePathSync(fs.realpathSync.native(fx.vault), path.join(evil, 'x.md')), 'sibling-prefix absolute')
    assert.equal(cp.isInside(fx.vault, evil), false)
    assert.equal(cp.isInside(fx.vault, path.join(fx.vault, 'Home.md')), true)
    assert.equal(cp.isInside(fx.vault, fx.vault), false)
    assert.equal(cp.isInside(fx.vault, fx.vault, true), true)
  } finally {
    fx.cleanup()
  }
})

test('missing note is 404, not a policy error leak', () => {
  const fx = makeFixture()
  try {
    assert.throws(() => cp.readNoteSafe(fx.vault, 'nope.md'), (e) => e.status === 404)
  } finally {
    fx.cleanup()
  }
})

test('symlinked file, symlinked directory and junction inside the vault are rejected and not walked', (t) => {
  const fx = makeFixture()
  try {
    const fileLink = path.join(fx.vault, 'link-file.md')
    const dirLink = path.join(fx.vault, 'link-dir')
    const junction = path.join(fx.vault, 'junction-dir')
    const made = {
      file: tryLink(path.join(fx.outside, 'secret.md'), fileLink, 'file'),
      dir: tryLink(fx.outside, dirLink, 'dir'),
      junction: tryLink(fx.outside, junction, 'junction'),
    }
    if (!made.file && !made.dir && !made.junction) return t.skip('cannot create symlinks/junctions here (privilege)')
    if (made.file) expectDenied(() => cp.readNoteSafe(fx.vault, 'link-file.md'), 'file symlink')
    if (made.dir) expectDenied(() => cp.readNoteSafe(fx.vault, 'link-dir/secret.md'), 'dir symlink')
    if (made.junction) expectDenied(() => cp.readNoteSafe(fx.vault, 'junction-dir/secret.md'), 'junction')
    return cp.walkMarkdownFiles(fx.vault).then(({ files, skipped }) => {
      const rel = files.map((f) => path.relative(fs.realpathSync.native(fx.vault), f).split(path.sep).join('/')).sort()
      assert.deepEqual(rel, ['Home.md', 'notes/deep/Deep.md'])
      assert.ok(skipped >= 1, 'links must be counted as skipped')
      assert.ok(!files.some((f) => f.includes('SECRET')))
    })
  } finally {
    // cleanup after async walk: schedule on next tick of the test promise
    t.after(() => fx.cleanup())
  }
})

test('walk returns only real .md files, skips hidden and policy-violating names', async () => {
  const fx = makeFixture()
  try {
    fs.mkdirSync(path.join(fx.vault, '.obsidian'))
    fs.writeFileSync(path.join(fx.vault, '.obsidian', 'hidden.md'), 'x')
    fs.writeFileSync(path.join(fx.vault, 'notes', '.dot.md'), 'x')
    fs.writeFileSync(path.join(fx.vault, 'Decision - Local First.md'), '# ok')
    const { files } = await cp.walkMarkdownFiles(fx.vault)
    const rel = files.map((f) => path.relative(fs.realpathSync.native(fx.vault), f).split(path.sep).join('/')).sort()
    assert.deepEqual(rel, ['Decision - Local First.md', 'Home.md', 'notes/deep/Deep.md'])
    assert.equal(await cp.countMarkdownFiles(fx.vault), 3)
  } finally {
    fx.cleanup()
  }
})

test('verified read rejects a file swapped for a link after the check (race re-verify)', (t) => {
  const fx = makeFixture()
  try {
    const root = fs.realpathSync.native(fx.vault)
    const target = path.join(root, 'Home.md')
    // Path outside the root can never pass verification, even as an absolute path handed to the reader
    expectDenied(() => cp.readVerifiedNote(root, path.join(fx.outside, 'secret.md')), 'outside absolute path')
    // Replace the note with a symlink and confirm the reader refuses at use time
    fs.rmSync(target)
    if (!tryLink(path.join(fx.outside, 'secret.md'), target, 'file')) return t.skip('cannot create symlink here (privilege)')
    expectDenied(() => cp.readVerifiedNote(root, target), 'swapped symlink')
  } finally {
    fx.cleanup()
  }
})

test('oversized notes are refused', () => {
  const fx = makeFixture()
  try {
    fs.writeFileSync(path.join(fx.vault, 'big.md'), Buffer.alloc(cp.MAX_NOTE_BYTES + 1, 97))
    assert.throws(() => cp.readNoteSafe(fx.vault, 'big.md'), (e) => e.status === 413)
  } finally {
    fx.cleanup()
  }
})

test('segmentProblem accepts ordinary vault names', () => {
  for (const ok of ['Home.md', 'Decision - Local First.md', 'Project Lantern.md', 'a_b-c (1).md', 'Ünïcode.md']) {
    assert.equal(cp.segmentProblem(ok), null, ok)
  }
})
