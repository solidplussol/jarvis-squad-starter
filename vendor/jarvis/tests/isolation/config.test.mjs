// SPDX-License-Identifier: AGPL-3.0-only
// MODIFIED 2026-11-07 for Connected AI Brain Lab project-only isolation (new file; see MODIFICATIONS).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeFixture, serverModule, tryLink } from './_helpers.mjs'

const cfg = await serverModule('config.ts')

function spyFs() {
  const touched = []
  return {
    touched,
    lstatSync: (p) => { touched.push(p); return fs.lstatSync(p) },
    realpathSync: (p) => { touched.push(p); return fs.realpathSync.native(p) },
  }
}

test('resolver ignores conflicting global config, env fallbacks and never touches home', () => {
  const fx = makeFixture()
  const origHomedir = os.homedir
  let homedirCalls = 0
  os.homedir = () => { homedirCalls++; return fx.home }
  try {
    const before = fs.readFileSync(fx.canaryConfig, 'utf-8')
    const mtimeBefore = fs.statSync(fx.canaryConfig).mtimeMs
    const spy = spyFs()
    const r = cfg.resolveConfig({ env: fx.env(), appDir: fx.appDir, fs: spy })
    assert.equal(r.mode, 'project')
    assert.equal(r.vaultPath, fs.realpathSync.native(fx.vault))
    assert.equal(r.apiPort, 3002)
    assert.equal(r.uiPort, 5173)
    assert.equal(homedirCalls, 0, 'os.homedir must not be called')
    for (const p of spy.touched) {
      assert.ok(!p.startsWith(fx.home), `resolver touched home canary path: ${p}`)
      assert.ok(!p.startsWith(fx.other), `resolver touched fallback vault path: ${p}`)
    }
    assert.equal(fs.readFileSync(fx.canaryConfig, 'utf-8'), before)
    assert.equal(fs.statSync(fx.canaryConfig).mtimeMs, mtimeBefore)
    assert.deepEqual([...r.allowedRoots], [fs.realpathSync.native(fx.appDir), r.vaultPath])
  } finally {
    os.homedir = origHomedir
    fx.cleanup()
  }
})

test('mode detection: unset is upstream, ambiguous values and orphan vault var fail closed', () => {
  assert.equal(cfg.resolveConfig({ env: {} }).mode, 'upstream')
  assert.equal(cfg.resolveConfig({ env: { JARVIS_PROJECT_MODE: '0' } }).mode, 'upstream')
  assert.throws(() => cfg.resolveConfig({ env: { JARVIS_PROJECT_MODE: 'true' } }), cfg.ProjectConfigError)
  assert.throws(() => cfg.resolveConfig({ env: { JARVIS_PROJECT_VAULT: 'x' } }), cfg.ProjectConfigError)
})

test('invalid vault values fail before any further side effect', () => {
  const fx = makeFixture()
  try {
    const cases = {
      missing: undefined,
      empty: '',
      relative: path.join('..', 'project', 'demo-vault'),
      'relative bare': 'demo-vault',
      unc: '\\\\server\\share\\demo-vault',
      'unc forward': '//server/share/demo-vault',
      'device path': '\\\\?\\' + fx.vault,
      sibling: fx.other,
      'sibling-prefix': fx.vault + '-evil',
      'child dir': path.join(fx.vault, 'notes'),
      parent: fx.root,
      'dot segments': path.join(fx.vault, '..', 'demo-vault') + path.sep + '.',
      'trailing space': fx.vault + ' ',
      nul: fx.vault + '\0',
      ads: fx.vault + ':stream',
      file: path.join(fx.vault, 'Home.md'),
    }
    for (const [name, value] of Object.entries(cases)) {
      const spy = spyFs()
      assert.throws(
        () => cfg.resolveConfig({ env: fx.env({ JARVIS_PROJECT_VAULT: value }), appDir: fx.appDir, fs: spy }),
        cfg.ProjectConfigError,
        `case "${name}" must be rejected`,
      )
    }
  } finally {
    fx.cleanup()
  }
})

test('pure-string rejections happen before any fs access', () => {
  const fx = makeFixture()
  try {
    for (const bad of [undefined, 'demo-vault', '\\\\srv\\x', fx.vault + '\0', fx.vault + '-evil', fx.other]) {
      const spy = spyFs()
      assert.throws(() => cfg.resolveConfig({ env: fx.env({ JARVIS_PROJECT_VAULT: bad }), appDir: fx.appDir, fs: spy }))
      assert.equal(spy.touched.length, 0, `fs touched for ${JSON.stringify(bad)}`)
    }
  } finally {
    fx.cleanup()
  }
})

test('wrong case is rejected (exact path required)', { skip: process.platform !== 'win32' && 'case-insensitive FS only' }, () => {
  const fx = makeFixture()
  try {
    const swapped = fx.vault.replace(/demo-vault$/, 'DEMO-VAULT')
    assert.notEqual(swapped, fx.vault)
    assert.throws(() => cfg.resolveConfig({ env: fx.env({ JARVIS_PROJECT_VAULT: swapped }), appDir: fx.appDir }), cfg.ProjectConfigError)
  } finally {
    fx.cleanup()
  }
})

test('missing vault directory and file-instead-of-directory fail', () => {
  const fx = makeFixture()
  try {
    fs.rmSync(fx.vault, { recursive: true })
    assert.throws(() => cfg.resolveConfig({ env: fx.env(), appDir: fx.appDir }), /does not exist/)
    fs.writeFileSync(fx.vault, 'i am a file')
    assert.throws(() => cfg.resolveConfig({ env: fx.env(), appDir: fx.appDir }), /not a directory/)
  } finally {
    fx.cleanup()
  }
})

test('vault that is a symlink/junction pointing elsewhere is rejected', (t) => {
  const fx = makeFixture()
  try {
    fs.rmSync(fx.vault, { recursive: true })
    if (!tryLink(fx.other, fx.vault, 'junction')) return t.skip('cannot create junction/symlink here (privilege)')
    assert.throws(() => cfg.resolveConfig({ env: fx.env(), appDir: fx.appDir }), cfg.ProjectConfigError)
  } finally {
    fx.cleanup()
  }
})

test('ports: defaults, overrides, invalid and colliding values', () => {
  const fx = makeFixture()
  try {
    const ok = cfg.resolveConfig({ env: fx.env({ JARVIS_PROJECT_API_PORT: '4001', JARVIS_PROJECT_UI_PORT: '4002' }), appDir: fx.appDir })
    assert.equal(ok.apiPort, 4001)
    assert.equal(ok.uiPort, 4002)
    for (const bad of ['80', 'abc', '70000', '3002.5', '-1']) {
      assert.throws(() => cfg.resolveConfig({ env: fx.env({ JARVIS_PROJECT_API_PORT: bad }), appDir: fx.appDir }), cfg.ProjectConfigError, bad)
    }
    assert.throws(() => cfg.resolveConfig({ env: fx.env({ JARVIS_PROJECT_API_PORT: '5173' }), appDir: fx.appDir }), /differ/)
  } finally {
    fx.cleanup()
  }
})

test('bind host, vite options and offline feature flags', () => {
  const fx = makeFixture()
  try {
    const r = cfg.resolveConfig({ env: fx.env(), appDir: fx.appDir })
    assert.equal(cfg.BIND_HOST, '127.0.0.1')
    assert.equal(r.bindHost, '127.0.0.1')
    const vite = cfg.buildViteServerOptions(r)
    assert.equal(vite.host, '127.0.0.1')
    assert.equal(vite.strictPort, true)
    assert.equal(vite.fs.strict, true)
    assert.deepEqual(vite.fs.allow, [r.appDir])
    assert.ok(!vite.fs.allow.includes(r.vaultPath))
    assert.deepEqual(vite.allowedHosts, ['127.0.0.1', 'localhost'])
    assert.equal(vite.proxy['/api'].target, 'http://127.0.0.1:3002')
    assert.ok(!JSON.stringify(vite.cors).includes('*'))
    const preview = cfg.buildVitePreviewOptions(r)
    assert.equal(preview.host, '127.0.0.1')
    assert.equal(preview.strictPort, true)
    for (const [flag, value] of Object.entries(cfg.DISABLED_FEATURES)) assert.equal(value, false, flag)
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.features))
    assert.deepEqual([...r.allowedOrigins].sort(), [
      'http://127.0.0.1:3002', 'http://127.0.0.1:5173', 'http://localhost:3002', 'http://localhost:5173',
    ])
  } finally {
    fx.cleanup()
  }
})

test('isInsideOrEqual is not fooled by sibling prefixes', () => {
  const root = path.join(path.parse(process.cwd()).root, 'a', 'vault')
  assert.equal(cfg.isInsideOrEqual(root, root), true)
  assert.equal(cfg.isInsideOrEqual(root, path.join(root, 'x', 'y.md')), true)
  assert.equal(cfg.isInsideOrEqual(root, root + '-evil'), false)
  assert.equal(cfg.isInsideOrEqual(root, path.join(root, '..', 'vault2')), false)
})
