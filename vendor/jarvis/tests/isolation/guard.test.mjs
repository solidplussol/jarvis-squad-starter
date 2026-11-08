// SPDX-License-Identifier: AGPL-3.0-only
// MODIFIED 2026-11-07 for Connected AI Brain Lab project-only isolation (new file; see MODIFICATIONS).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { APP_DIR, makeFixture, serverModule } from './_helpers.mjs'

const rg = await serverModule('request-guard.ts')
const cfg = await serverModule('config.ts')

const hosts = ['127.0.0.1:3002', 'localhost:3002', '127.0.0.1:5173', 'localhost:5173']
const origins = ['http://127.0.0.1:5173', 'http://localhost:5173']
const base = { allowedHostHeaders: hosts, allowedOrigins: origins }

test('Host validation is an exact allow-list', () => {
  for (const h of hosts) assert.equal(rg.isHostAllowed(h, hosts), true, h)
  assert.equal(rg.isHostAllowed('LOCALHOST:5173', hosts), true)
  for (const h of [undefined, '', 'evil.com', 'evil.com:5173', '127.0.0.1', '127.0.0.1:9999', '127.0.0.1:5173, evil.com',
    '[::1]:5173', '0.0.0.0:5173', 'localhost.evil.com:5173', '127.0.0.1:5173 ']) {
    assert.equal(rg.isHostAllowed(h, hosts), false, String(h))
  }
})

test('Origin validation: exact match, absent allowed, null/foreign/prefix rejected', () => {
  assert.equal(rg.isOriginAllowed(undefined, origins), true)
  for (const o of origins) assert.equal(rg.isOriginAllowed(o, origins), true)
  for (const o of ['null', 'https://evil.com', 'http://127.0.0.1:5173.evil.com', 'http://127.0.0.1:5173/', 'https://127.0.0.1:5173', 'http://127.0.0.1:9', '*', '']) {
    assert.equal(rg.isOriginAllowed(o, origins), false, o)
  }
})

test('mutating methods are blocked, safe methods pass', () => {
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'PROPFIND', undefined]) {
    assert.equal(rg.isMutatingMethod(m), true, String(m))
    if (m) assert.equal(rg.evaluateRequest({ ...base, method: m, host: hosts[0] }).status, 403)
  }
  for (const m of ['GET', 'HEAD', 'OPTIONS', 'get']) assert.equal(rg.isMutatingMethod(m), false, m)
  assert.deepEqual(rg.evaluateRequest({ ...base, method: 'GET', host: hosts[0], origin: origins[0] }), { allow: true, status: 200 })
  assert.equal(rg.evaluateRequest({ ...base, method: 'GET', host: 'evil.com' }).allow, false)
  assert.equal(rg.evaluateRequest({ ...base, method: 'GET', host: hosts[0], origin: 'https://evil.com' }).allow, false)
})

test('CORS never emits a wildcard and only echoes allowed origins', () => {
  assert.equal(rg.corsHeadersFor(origins[0], origins)['Access-Control-Allow-Origin'], origins[0])
  assert.equal(rg.corsHeadersFor('https://evil.com', origins)['Access-Control-Allow-Origin'], undefined)
  assert.equal(rg.corsHeadersFor(undefined, origins)['Access-Control-Allow-Origin'], undefined)
  assert.ok(!Object.values(rg.corsHeadersFor(origins[0], origins)).includes('*'))
})

test('index.html transform removes Google Fonts and adds a CSP; real file is untouched', () => {
  const html = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf-8')
  assert.match(html, /fonts\.googleapis\.com/, 'upstream index.html is intentionally unchanged')
  const out = rg.transformHtmlForProjectMode(html, 5173)
  assert.doesNotMatch(out, /googleapis|gstatic/)
  assert.match(out, /Content-Security-Policy/)
  const csp = rg.buildContentSecurityPolicy(5173)
  assert.match(csp, /default-src 'self'/)
  assert.doesNotMatch(csp, /https?:\/\/(?!127\.0\.0\.1|localhost)/)
})

test('refresh route requires same-origin signals and custom header', () => {
  const ok = { allowedOrigins: origins, refreshHeader: '1' }
  assert.equal(rg.checkRefreshRequest({ ...ok }).allow, true)
  assert.equal(rg.checkRefreshRequest({ ...ok, secFetchSite: 'same-origin' }).allow, true)
  assert.equal(rg.checkRefreshRequest({ ...ok, secFetchSite: 'none' }).allow, true)
  assert.equal(rg.checkRefreshRequest({ ...ok, origin: origins[0] }).allow, true)
  for (const site of ['cross-site', 'same-site', '', ['same-origin']]) {
    assert.equal(rg.checkRefreshRequest({ ...ok, secFetchSite: site }).allow, false, String(site))
  }
  assert.equal(rg.checkRefreshRequest({ ...ok, origin: 'https://evil.com' }).allow, false)
  assert.equal(rg.checkRefreshRequest({ ...ok, origin: 'null' }).allow, false)
  for (const h of [undefined, '', '0', 'true', ['1']]) {
    assert.equal(rg.checkRefreshRequest({ allowedOrigins: origins, refreshHeader: h }).allow, false, String(h))
  }
  assert.equal(rg.REFRESH_HEADER, 'x-jarvis-refresh')
})

test('dev-server /@fs requests outside appDir or into the vault are forbidden', () => {
  const app = 'C:\\Proj\\vendor\\jarvis'
  const vault = 'C:\\Proj\\demo-vault'
  const f = (u) => rg.isForbiddenDevFsRequest(u, app, vault)
  const denied = [
    '/@fs/C:/Proj/demo-vault/Home.md',
    '/@fs/C:/Proj/demo-vault/Home.md?raw',
    '/@fs/C:/Proj/demo-vault/Home.md?import&raw',
    '/@fs/c:/proj/DEMO-VAULT/.obsidian/app.json',
    '/@fs/C:\\Proj\\demo-vault\\Home.md',
    '/@fs/C:%5CProj%5Cdemo-vault%5CHome.md',
    '/@fs/C%3A/Proj/demo-vault/Home.md',
    '/@fs/C:/Proj/demo%2Dvault/Home.md',
    '/@fs/C:/Proj/%2564emo-vault/Home.md',
    '/@fs//C:/Proj/demo-vault/Home.md',
    '/@fs/C:/Proj/vendor/jarvis/../../demo-vault/Home.md',
    '/@fs/C:/Proj/vendor/jarvis/%2e%2e/%2e%2e/demo-vault/Home.md',
    '/@FS/C:/Proj/demo-vault/Home.md',
    '/@fs/C:/Windows/win.ini',
    '/@fs/C:/Proj/vendor/jarvis-evil/x.ts',
    '/@fs/C:/Proj/vendor',
    '/@fs/',
    '/@fs',
    '/@fs/etc/passwd',
    '/@fs/C:/Proj/vendor/jarvis/%',
    '//@fs/C:/Windows/win.ini',
    undefined,
  ]
  for (const u of denied) assert.equal(f(u), true, String(u))
  const allowed = [
    '/',
    '/src/main.tsx',
    '/@vite/client',
    '/@react-refresh',
    '/@fs/C:/Proj/vendor/jarvis/src/main.tsx',
    '/@fs/c:\\proj\\vendor\\jarvis\\src\\App.tsx?import',
    '/node_modules/.vite/deps/react.js?v=1',
    '/api/note?path=Home.md',
  ]
  for (const u of allowed) assert.equal(f(u), false, u)
})

test('/@fs dot-segment bypass forms are forbidden', () => {
  const app = 'C:\\Proj\\vendor\\jarvis'
  const vault = 'C:\\Proj\\demo-vault'
  for (const u of [
    '/@fs/../../etc/passwd',
    '/@fs/%2e%2e/%2e%2e/x',
    '/@fs/x/../../Windows/win.ini',
    '/@fs/../Proj/demo-vault/Home.md',
    '/@fs/../Proj/demo-vault/Home.md?raw',
    '/@fs/%2e%2e/Proj/demo-vault/Home.md',
    '/@fs/./C:/Proj/vendor/jarvis/src/main.tsx',
    '/@fs/C:/Proj/vendor/jarvis/src/../../../demo-vault/Home.md',
    '/@fs/C:\\Proj\\vendor\\jarvis\\..\\..\\demo-vault\\Home.md',
    '/src/../@fs/C:/Windows/win.ini',
    '/@fs/Proj/demo-vault/Home.md',
    '/@fs/Windows/win.ini',
  ]) assert.equal(rg.isForbiddenDevFsRequest(u, app, vault), true, u)
  for (const u of ['/@fs/C:/Proj/vendor/jarvis/src/main.tsx', '/src/main.tsx', '/@vite/client']) {
    assert.equal(rg.isForbiddenDevFsRequest(u, app, vault), false, u)
  }
})

test('non-/@fs traversal, vault names and dotfiles are forbidden; app URLs stay allowed', () => {
  const app = 'C:\\Proj\\vendor\\jarvis'
  const vault = 'C:\\Proj\\demo-vault'
  const f = (u) => rg.isForbiddenDevFsRequest(u, app, vault)
  for (const u of [
    '/src/..%2f..%2fdemo-vault/Home.md',
    '/src/../../demo-vault/Home.md',
    '/../../demo-vault/Home.md',
    '/%2e%2e/%2e%2e/demo-vault/Home.md',
    '/src/..%5c..%5c..%5cdemo-vault%5cHome.md',
    '/src/..%252f..%252fdemo-vault/Home.md',
    '/node_modules/.vite/../../../../demo-vault/Home.md',
    '/demo-vault/Home.md',
    '/DEMO-VAULT/Home.md',
    '//Proj/demo-vault/Home.md',
    '/src/../../Windows/win.ini',
    '/src/./main.tsx',
    '/.env',
    '/.git/config',
    '/src/.hidden/x.ts',
    '/foo/.vite/x.js',
    '/.vite/deps/react.js',
  ]) assert.equal(f(u), true, u)
  for (const u of [
    '/', '/index.html', '/@vite/client', '/@id/react', '/@react-refresh',
    '/node_modules/.vite/deps/react.js?v=1', '/src/main.tsx', '/api/graph',
    '/@fs/C:/Proj/vendor/jarvis/src/main.tsx?import',
    '/@fs/C:/Proj/vendor/jarvis/node_modules/.vite/deps/react.js?v=1',
  ]) assert.equal(f(u), false, u)
})

test('embeddings are disabled in project mode without loading the model or writing', async () => {
  const fx = makeFixture()
  const saved = process.env.JARVIS_PROJECT_MODE
  process.env.JARVIS_PROJECT_MODE = '1'
  try {
    const emb = await serverModule('embeddings.ts')
    const status = emb.getSemanticStatus()
    assert.equal(status.ready, false)
    assert.equal(status.disabled, true)
    const res = await emb.semanticSearch('anything', 5)
    assert.equal(res.disabled, true)
    assert.deepEqual(res.results, [])
    assert.deepEqual(fs.readdirSync(fx.home), ['.jarvis-config.yaml'])
  } finally {
    if (saved === undefined) delete process.env.JARVIS_PROJECT_MODE
    else process.env.JARVIS_PROJECT_MODE = saved
    fx.cleanup()
  }
})

test('AGPL LICENSE is byte-identical to git HEAD', () => {
  const git = (...a) => execFileSync('git', ['-C', APP_DIR, ...a], { encoding: 'utf-8' }).trim()
  const head = git('rev-parse', 'HEAD:LICENSE')
  const working = git('hash-object', 'LICENSE')
  assert.equal(working, head)
  assert.equal(head, 'be3f7b28e564e7dd05eaf59d64adba1a4065ac0e')
})

test('non-source runtime artifacts under appDir are forbidden in every encoding; source URLs stay allowed', () => {
  const app = 'C:\\Proj\\vendor\\jarvis'
  const vault = 'C:\\Proj\\demo-vault'
  const f = (u) => rg.isForbiddenDevFsRequest(u, app, vault)
  for (const u of [
    '/@fs/C:/Proj/vendor/jarvis/api.out.log', '/@fs/C:/Proj/vendor/jarvis/api.err.log',
    '/@fs/C:/Proj/vendor/jarvis/optimization-log.json', '/@fs/C:/Proj/vendor/jarvis/tsconfig.app.tsbuildinfo',
    '/@fs/C:/Proj/vendor/jarvis/MODIFICATIONS', '/api.out.log', '/optimization-log.json?raw', '/MODIFICATIONS',
    '/@fs/C:/Proj/vendor/jarvis/API.OUT.LOG', '/@fs/C:/Proj/vendor/jarvis/Modifications',
    '/@fs/C:/Proj/vendor/jarvis/api.out%2elog', '/@fs/C:%5CProj%5Cvendor%5Cjarvis%5Capi.out.log',
    '/@fs/C:/Proj/vendor/jarvis/api.out.log.', '/@fs/C:/Proj/vendor/jarvis/api.out.log%20',
    '/@fs/C:/Proj/vendor/jarvis/api.out.log::$DATA', '/@fs/C:/Proj/vendor/jarvis/api.out.log:stream',
    '/@fs/C:/Proj/vendor/jarvis/MODIFICATIONS.', '/@fs/C:/Proj/vendor/jarvis/.env', '/src/x.tsbuildinfo?import',
  ]) assert.equal(f(u), true, u)
  for (const u of [
    '/', '/index.html', '/src/main.tsx', '/src/App.tsx?t=1', '/@vite/client', '/@id/virtual:foo',
    '/node_modules/.vite/deps/react.js?v=abc', '/@fs/C:/Proj/vendor/jarvis/src/main.tsx', '/assets/index-abc.js',
    '/node_modules/vite/dist/client/env.mjs', '/node_modules/vite/dist/client/env.mjs?t=1', '/src/env.ts',
  ]) assert.equal(f(u), false, u)
  for (const u of [
    '/.env.local', '/env', '/env.local', '/env.production', '/src/.env', '/@fs/C:/Proj/vendor/jarvis/env.local',
    '/x/foo.env', '/node_modules/vite/dist/client/env.mjs::$DATA', '/node_modules/vite/dist/client/env.mjs.',
  ]) assert.equal(f(u), true, u)
})
