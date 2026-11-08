// Verification's independent tests for isForbiddenDevFsRequest / checkRefreshRequest. Pure logic, no I/O.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { APP_DIR, serverModule } from './_helpers.mjs'

const g = await serverModule('request-guard.ts')
const APP = APP_DIR
const VAULT = path.join(path.resolve(APP, '..', '..'), 'demo-vault')
const fwd = (p) => p.replace(/\\/g, '/')
const forbid = (u) => g.isForbiddenDevFsRequest(u, APP, VAULT)

test('/@fs: forbidden forms', () => {
  const v = fwd(VAULT)
  const outside = 'C:/Windows/win.ini'
  const bad = [
    `/@fs/${v}/Home.md`, `/@fs/${v}/Home.md?raw`, `/@fs/${v}/Home.md?import`, `/@fs/${v}/Home.md?import&raw`, `/@fs/${v}/Home.md?url#x`,
    `/@fs/${v.toUpperCase()}/Home.md`, `/@fs/${v.toLowerCase()}/Home.md`,
    `/@fs/${VAULT}\\Home.md`, `/@fs/${VAULT.replace(/\\/g, '%5C')}%5CHome.md`,
    `/@fs/${encodeURIComponent(v)}/Home.md`, `/@fs/${encodeURIComponent(encodeURIComponent(v))}/Home.md`,
    `/@fs/${encodeURIComponent(encodeURIComponent(encodeURIComponent(v)))}`,
    `/@fs/${v.replace(/\//g, '%2f')}`, `/@fs/${v.replace(':', '%3a')}/Home.md`,
    `/@fs//${v}/Home.md`, `/@fs/${v}//Home.md`, `/@fs/./${v}/Home.md`, `/@FS/${v}/Home.md`, `/@Fs/${v}/Home.md`,
    `/@fs/${fwd(APP)}/../../demo-vault/Home.md`, `/@fs/${fwd(APP)}/src/..%2F..%2F..%2Fdemo-vault%2FHome.md`,
    `/@fs/${fwd(APP)}/..%252f..%252fdemo-vault/Home.md`,
    `/src/../@fs/${v}/Home.md`, `/foo/@fs/${v}/Home.md`, `/${v}/Home.md`, `/x?/@fs/${v}`.replace('?', '/'),
    `/@fs/${outside}`, `/@fs/${outside}?raw`, '/@fs/C:\\Windows\\win.ini', '/@fs//Windows/win.ini', '/@fs/etc/passwd', '/@fs/../../etc/passwd',
    '/@fs/', '/@fs', '/@fs/D:/x', '/@fs/C%3A/Windows/win.ini', '/@fs/%2e%2e/%2e%2e/x',
    `/@fs/${fwd(APP)}-evil/x.ts`, `/@fs/${fwd(path.dirname(APP))}/other`, `/@fs/${fwd(VAULT)}/./Home.md`,
    `/@fs/${v}/Home.md%00.png`, '/a%', '/%E0%A4%A', `/@fs/${v}%00`, undefined,
  ]
  const failed = bad.filter((u) => !forbid(u))
  assert.deepEqual(failed, [])
})

test('/@fs: legitimate app requests allowed', () => {
  const a = fwd(APP)
  for (const u of ['/', '/index.html', '/src/main.tsx', '/src/App.tsx?t=123', '/@vite/client', '/@react-refresh', '/node_modules/.vite/deps/react.js?v=1', '/api/graph',
    `/@fs/${a}/src/main.tsx`, `/@fs/${a}/src/main.tsx?import`, `/@fs/${a}/node_modules/three/build/three.module.js?v=abc`, `/@fs/${a.toUpperCase()}/src/main.tsx`,
    `/@fs/${encodeURIComponent(a)}/src/main.tsx`]) {
    assert.equal(forbid(u), false, u)
  }
})

const O = ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:3002', 'http://localhost:3002']
const chk = (x) => g.checkRefreshRequest({ allowedOrigins: O, ...x }).allow

test('refresh endpoint header/origin/fetch-metadata matrix', () => {
  const H = '1'
  assert.equal(chk({ refreshHeader: H }), true)
  assert.equal(chk({ refreshHeader: H, secFetchSite: 'same-origin' }), true)
  assert.equal(chk({ refreshHeader: H, secFetchSite: 'none' }), true)
  assert.equal(chk({ refreshHeader: H, origin: O[0], secFetchSite: 'same-origin' }), true)
  assert.equal(chk({ refreshHeader: H, origin: O[1] }), true)
  // missing / wrong header
  for (const h of [undefined, '', '0', 'true', ' 1', '1 ', '11', ['1'], ['1', '1'], 'yes']) assert.equal(chk({ refreshHeader: h }), false, JSON.stringify(h))
  // cross-site metadata
  for (const s of ['cross-site', 'same-site', 'Same-Origin', '', ['same-origin'], ['same-origin', 'cross-site']]) assert.equal(chk({ refreshHeader: H, secFetchSite: s }), false, JSON.stringify(s))
  // bad origins even with header + same-origin
  for (const o of ['null', 'http://evil.com', 'http://127.0.0.1:5173/', 'https://localhost:5173', '*', '', 'http://localhost:5173.evil.com'])
    assert.equal(chk({ refreshHeader: H, secFetchSite: 'same-origin', origin: o }), false, o)
  // simple cross-site GET (e.g. <img src>) with no header
  assert.equal(chk({ origin: 'http://evil.com', secFetchSite: 'cross-site' }), false)
  assert.equal(chk({}), false)
  assert.equal(g.checkRefreshRequest({ allowedOrigins: O, refreshHeader: '1', secFetchSite: 'cross-site' }).status, 403)
})
