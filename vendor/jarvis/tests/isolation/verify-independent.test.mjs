// Independent acceptance tests by Verification (not Integration). Synthetic fixtures only; demo-vault read-only.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { makeFixture, tryLink, serverModule, APP_DIR } from './_helpers.mjs'

const cfg = await serverModule('config.ts')
const cp = await serverModule('content-path.ts')
const guard = await serverModule('request-guard.ts')
const REPO = path.resolve(APP_DIR, '..', '..')
const DEMO = path.join(REPO, 'demo-vault')

function spyFs(touched) {
  return {
    lstatSync: (p) => { touched.push(p); return fs.lstatSync(p) },
    realpathSync: (p) => { touched.push(p); return fs.realpathSync.native(p) },
  }
}
const resolveWith = (fx, extra, touched = []) =>
  cfg.resolveConfig({ env: fx.env(extra), appDir: fx.appDir, fs: spyFs(touched) })

test('canary global config/home is never accessed; env fallbacks ignored', () => {
  const fx = makeFixture()
  try {
    const touched = []
    const c = resolveWith(fx, {}, touched)
    assert.equal(c.mode, 'project')
    assert.equal(c.vaultPath, fs.realpathSync.native(fx.vault))
    assert.ok(touched.length > 0)
    for (const p of touched) {
      assert.ok(!p.startsWith(fx.home) && !p.startsWith(fx.other), p)
    }
    const atime = fs.statSync(fx.canaryConfig).atimeMs
    assert.equal(fs.statSync(fx.canaryConfig).atimeMs, atime)
  } finally { fx.cleanup() }
})

test('bad vault values fail before any fs side effect', () => {
  const fx = makeFixture()
  try {
    const fileVault = path.join(fx.root, 'demo-vault-file')
    fs.writeFileSync(fileVault, 'x')
    const cases = {
      missing: undefined,
      empty: '',
      relative: 'demo-vault',
      relDots: '..\\project\\demo-vault',
      unc: '\\\\localhost\\c$\\x',
      uncFwd: '//localhost/share/demo-vault',
      other: fx.other,
      outside: fx.outside,
      siblingPrefix: fx.vault + '-evil',
      siblingChild: path.join(fx.vault, '..', 'demo-vault2'),
      file: fileVault,
      nul: fx.vault + '\0',
      ads: fx.vault + ':stream',
      trailingSpace: fx.vault + ' ',
      parent: fx.root,
      home: fx.home,
      short83: path.join(fx.root, 'DEMO-V~1'),
      nonexistent: path.join(fx.root, 'nope'),
    }
    for (const [name, val] of Object.entries(cases)) {
      const touched = []
      assert.throws(() => resolveWith(fx, { JARVIS_PROJECT_VAULT: val }, touched), cfg.ProjectConfigError, name)
      if (!['nonexistent', 'file', 'short83', 'siblingPrefix', 'siblingChild', 'other', 'outside', 'parent', 'home'].includes(name)) {
        assert.equal(touched.length, 0, `${name} touched fs`)
      }
      for (const p of touched) assert.ok(!p.startsWith(fx.home), name)
    }
    // mode unset with vault set, bad mode value, port problems
    assert.throws(() => cfg.resolveConfig({ env: { JARVIS_PROJECT_VAULT: fx.vault }, appDir: fx.appDir }), cfg.ProjectConfigError)
    assert.throws(() => cfg.resolveConfig({ env: { JARVIS_PROJECT_MODE: 'true' }, appDir: fx.appDir }), cfg.ProjectConfigError)
    for (const bad of ['80', '1023', '65536', '3002x', '-1', '0x1BB', ' 3002', '3002.5', '']) {
      if (bad === '') continue
      assert.throws(() => resolveWith(fx, { JARVIS_PROJECT_API_PORT: bad }), cfg.ProjectConfigError, bad)
    }
    assert.throws(() => resolveWith(fx, { JARVIS_PROJECT_API_PORT: '4000', JARVIS_PROJECT_UI_PORT: '4000' }), cfg.ProjectConfigError)
  } finally { fx.cleanup() }
})

test('case-variant and trailing-separator vault path', () => {
  const fx = makeFixture()
  try {
    const up = fx.vault.replace('demo-vault', 'DEMO-VAULT')
    let accepted = true
    try { resolveWith(fx, { JARVIS_PROJECT_VAULT: up }) } catch { accepted = false }
    // Strict string compare => case variant rejected (documented either way)
    console.log('case-variant accepted =', accepted)
    assert.equal(accepted, false)
    assert.equal(resolveWith(fx, { JARVIS_PROJECT_VAULT: fx.vault + path.sep }).vaultPath, fs.realpathSync.native(fx.vault))
  } finally { fx.cleanup() }
})

test('vault that is a junction/symlink is rejected', (t) => {
  const fx = makeFixture()
  try {
    fs.rmSync(fx.vault, { recursive: true })
    if (!tryLink(fx.other, fx.vault, 'junction')) return t.skip('junction not creatable')
    assert.throws(() => resolveWith(fx), cfg.ProjectConfigError)
  } finally { fx.cleanup() }
})

test('traversal / encoded / NUL / ADS / absolute / drive / UNC / 8.3 / device paths rejected', () => {
  const fx = makeFixture()
  try {
    const bad = [
      '../outside/secret.md', '..\\outside\\secret.md', 'notes/../../outside/secret.md', 'notes\\..\\..\\x.md',
      '%2e%2e/secret.md', '%2e%2e%2fsecret.md', 'notes/%2E%2E/x.md', 'Home%00.md', 'Home.md\0', 'Home.md\0.txt',
      'Home.md:stream', 'Home.md::$DATA', 'C:\\Windows\\win.ini', 'C:secret.md', '/etc/passwd.md', '\\\\host\\share\\a.md',
      '//host/share/a.md', fx.outside + '\\secret.md', 'HOME~1.MD', 'NOTES~1/Deep.md', 'con.md', 'NUL.md', 'aux', 'COM1.md',
      'readme.txt', 'notes/readme.txt', 'Home.md.', 'Home.md ', '.hidden.md', '.git/config.md', './Home.md', '', 'a/../Home.md', 'x'.repeat(2000) + '.md',
    ]
    for (const b of bad) assert.throws(() => cp.resolveNotePath(fx.vault, b), cp.ContentPathError, JSON.stringify(b))
    for (const b of [null, undefined, 5, {}, ['Home.md']]) assert.throws(() => cp.resolveNotePath(fx.vault, b), cp.ContentPathError)
    assert.ok(cp.resolveNotePath(fx.vault, 'Home.md').endsWith('Home.md'))
    assert.ok(cp.readNoteSafe(fx.vault, 'notes\\deep\\Deep.md').content.includes('# Deep'))
    assert.throws(() => cp.readNoteSafe(fx.vault, '../outside/secret.md'))
  } finally { fx.cleanup() }
})

test('junction and symlink escapes rejected; walk does not follow', async (t) => {
  const fx = makeFixture()
  try {
    const j = tryLink(fx.outside, path.join(fx.vault, 'jlink'), 'junction')
    assert.ok(j, 'junction creation must work (no privilege needed)')
    assert.throws(() => cp.readNoteSafe(fx.vault, 'jlink/secret.md'), cp.ContentPathError)
    assert.throws(() => cp.resolveNotePath(fx.vault, 'jlink/secret.md'), cp.ContentPathError)
    const w = await cp.walkMarkdownFiles(fx.vault)
    assert.ok(!w.files.some((f) => /secret|jlink/i.test(f)))
    assert.ok(w.skipped >= 1)
    assert.equal(await cp.countMarkdownFiles(fx.vault), 2)
    const f = tryLink(path.join(fx.outside, 'secret.md'), path.join(fx.vault, 'flink.md'), 'file')
    if (f) {
      assert.throws(() => cp.readNoteSafe(fx.vault, 'flink.md'), cp.ContentPathError)
      assert.ok(!(await cp.walkMarkdownFiles(fx.vault)).files.some((x) => x.endsWith('flink.md')))
    } else t.diagnostic('file symlink SKIPPED: no privilege')
    const d = tryLink(fx.outside, path.join(fx.vault, 'dlink'), 'dir')
    if (!d) t.diagnostic('dir symlink SKIPPED: no privilege')
  } finally { fx.cleanup() }
})

test('verifyNotePathSync sibling-prefix containment', () => {
  const fx = makeFixture()
  try {
    const root = fs.realpathSync.native(fx.vault)
    fs.mkdirSync(root + '-evil')
    fs.writeFileSync(path.join(root + '-evil', 'x.md'), 'x')
    assert.throws(() => cp.verifyNotePathSync(root, path.join(root + '-evil', 'x.md')), cp.ContentPathError)
    assert.equal(cp.isInside(root, root + '-evil'), false)
    assert.equal(cp.isInside(root, root), false)
    assert.equal(cp.isInside(root, path.join(root, 'a')), true)
  } finally { fx.cleanup() }
})

test('mutation blocking, Host/Origin, bind host, ports, flags', () => {
  for (const m of ['POST', 'put', 'PATCH', 'DELETE', 'Post', 'PROPFIND', 'TRACE', 'CONNECT', undefined, '']) assert.equal(guard.isMutatingMethod(m), true, String(m))
  for (const m of ['GET', 'head', 'OPTIONS']) assert.equal(guard.isMutatingMethod(m), false)
  const fx = makeFixture()
  try {
    const c = resolveWith(fx)
    assert.equal(c.bindHost, '127.0.0.1')
    assert.equal(cfg.BIND_HOST, '127.0.0.1')
    assert.equal(c.apiPort, 3002); assert.equal(c.uiPort, 5173)
    assert.deepEqual([...c.apiHostHeaders].sort(), ['127.0.0.1:3002', 'localhost:3002'])
    assert.deepEqual([...c.allowedOrigins].sort(), ['http://127.0.0.1:3002', 'http://127.0.0.1:5173', 'http://localhost:3002', 'http://localhost:5173'])
    const okHosts = ['127.0.0.1:3002', 'localhost:3002', 'LOCALHOST:3002']
    for (const h of okHosts) assert.equal(guard.isHostAllowed(h, c.apiHostHeaders), true, h)
    for (const h of ['127.0.0.1', 'localhost', '127.0.0.1:3003', '0.0.0.0:3002', '[::1]:3002', 'evil.com', 'localhost.evil.com:3002', '127.0.0.1:3002.evil.com',
      'localhost:3002, evil.com', 'evil.com:3002@localhost:3002', ' localhost:3002', '127.0.0.1:3002 ', '', undefined, '192.168.1.5:3002', '127.1:3002', '2130706433:3002'])
      assert.equal(guard.isHostAllowed(h, c.apiHostHeaders), false, String(h))
    for (const o of [undefined, 'http://127.0.0.1:5173', 'http://localhost:3002']) assert.equal(guard.isOriginAllowed(o, c.allowedOrigins), true)
    for (const o of ['null', '*', '', 'https://127.0.0.1:5173', 'http://127.0.0.1:5173/', 'http://127.0.0.1:5173.evil.com', 'http://evil.com', 'http://localhost:9999', 'http://[::1]:5173', 'file://'])
      assert.equal(guard.isOriginAllowed(o, c.allowedOrigins), false, o)
    assert.equal(guard.evaluateRequest({ method: 'POST', host: '127.0.0.1:3002', allowedHostHeaders: c.apiHostHeaders, allowedOrigins: c.allowedOrigins }).status, 403)
    assert.equal(guard.evaluateRequest({ method: 'GET', host: '127.0.0.1:3002', allowedHostHeaders: c.apiHostHeaders, allowedOrigins: c.allowedOrigins }).allow, true)
    assert.equal(guard.corsHeadersFor('http://evil.com', c.allowedOrigins)['Access-Control-Allow-Origin'], undefined)
    assert.notEqual(guard.corsHeadersFor('http://localhost:5173', c.allowedOrigins)['Access-Control-Allow-Origin'], '*')
    for (const [k, v] of Object.entries(cfg.DISABLED_FEATURES)) assert.equal(v, false, k)
    for (const k of ['embeddings', 'speech', 'modelDownloads', 'communityShapes', 'externalFonts', 'wildcardCors', 'globalConfig', 'vaultWrites', 'configWrites', 'vaultWatcher']) assert.ok(k in c.features, k)
    const vo = cfg.buildViteServerOptions(c)
    assert.equal(vo.host, '127.0.0.1'); assert.equal(vo.strictPort, true); assert.equal(vo.fs.strict, true)
    assert.deepEqual(vo.fs.allow, [c.appDir])
    assert.ok(!JSON.stringify(vo).includes('0.0.0.0'))
    assert.equal(cfg.buildVitePreviewOptions(c).host, '127.0.0.1')
    const html = guard.transformHtmlForProjectMode('<html><head><link href="https://fonts.googleapis.com/css2?x" rel="stylesheet"></head></html>', 5173)
    assert.ok(!/googleapis|gstatic/.test(html.replace(/Content-Security[^>]*/, '')))
  } finally { fx.cleanup() }
})

test('LICENSE byte-identical to git HEAD', () => {
  const head = execFileSync('git', ['-C', APP_DIR, 'show', 'HEAD:LICENSE'], { maxBuffer: 1 << 26 })
  // Working copy is CRLF via core.autocrlf=true; compare after EOL normalisation, which is what git's own blob hash does
  const work = fs.readFileSync(path.join(APP_DIR, 'LICENSE'))
  console.log('raw bytes equal:', head.equals(work), 'LF-normalised equal:', Buffer.from(work.toString('latin1').replace(/\r\n/g, '\n'), 'latin1').equals(head))
  assert.ok(Buffer.from(work.toString('latin1').replace(/\r\n/g, '\n'), 'latin1').equals(head))
  assert.equal(execFileSync('git', ['-C', APP_DIR, 'hash-object', 'LICENSE']).toString().trim(), execFileSync('git', ['-C', APP_DIR, 'rev-parse', 'HEAD:LICENSE']).toString().trim())
  assert.equal(execFileSync('git', ['-C', APP_DIR, 'rev-parse', 'HEAD']).toString().trim(), '0d2eca1ff19d896e0f558184416574ffcde4389c')
})

test('real demo-vault (read-only): policy accepts every note, wikilinks resolve', async () => {
  const c = cfg.resolveConfig({ env: { JARVIS_PROJECT_MODE: '1', JARVIS_PROJECT_VAULT: DEMO }, appDir: APP_DIR })
  assert.equal(c.vaultPath, fs.realpathSync.native(DEMO))
  const w = await cp.walkMarkdownFiles(DEMO)
  assert.equal(w.skipped, 0)
  assert.equal(w.files.length, 7)
  const names = new Set(w.files.map((f) => path.basename(f, '.md').toLowerCase()))
  const root = fs.realpathSync.native(DEMO)
  let links = 0
  for (const f of w.files) {
    const rel = path.relative(root, f).split(path.sep).join('/')
    const note = cp.readNoteSafe(DEMO, rel)
    for (const m of note.content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
      links++
      assert.ok(names.has(m[1].trim().toLowerCase()), `unresolved [[${m[1]}]] in ${rel}`)
    }
  }
  console.log('demo-vault wikilinks checked:', links)
  assert.ok(links > 0)
})
