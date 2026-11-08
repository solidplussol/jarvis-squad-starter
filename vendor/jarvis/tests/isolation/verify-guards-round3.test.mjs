// Verification round 3: /@fs bypass probes. Non-/@fs traversal forms are reported via diagnostics, not asserted.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { APP_DIR, serverModule } from './_helpers.mjs'

const g = await serverModule('request-guard.ts')
const APP = APP_DIR
const VAULT = path.join(path.resolve(APP, '..', '..'), 'demo-vault')
const fwd = (p) => p.replace(/\\/g, '/')
const forbid = (u) => g.isForbiddenDevFsRequest(u, APP, VAULT)
const a = fwd(APP)
const v = fwd(VAULT)
const driveless = v.replace(/^[A-Za-z]:/, '')
const enc = encodeURIComponent

test('round3: /@fs forms must be forbidden', () => {
  const bad = [
    '/@fs/./x', '/@fs//..//x', '/@fs/%252e%252e/x', '/@fs/%252e%252e%252f%252e%252e/etc/passwd', '/@fs/C:/../', '/@fs/C:/..', '/@fs/..', '/@fs/.',
    `/@fs/${a}/./src/main.tsx`, `/@fs/${a}/src/../src/main.tsx`, `/@fs/${a}/..`, `/@fs/${a}/%2e%2e/%2e%2e/demo-vault/Home.md`,
    `/@fs/c%3a${driveless}/Home.md`, `/@fs/C%3A${driveless}/Home.md?raw`, `/@fs/${enc(v)}/Home.md?url`, `/@fs${driveless}/Home.md`, `/@fs${driveless}/Home.md?import`,
    `/@fs/${v}/Home.md?raw`, `/@fs/${v}/Home.md?import`, `/@fs/${v}/Home.md?url`, `/@fs/${v}/Home.md?raw&import`, `/@fs/${v}/Home.md#frag`,
    `/@fs/${VAULT}\\Home.md`, `/@fs/${VAULT.replace(/\\/g, '\\\\')}\\Home.md`, `/@Fs/${v.toUpperCase()}/Home.md`, `/@FS${driveless.toUpperCase()}/HOME.MD`,
    `\\@fs\\${VAULT}\\Home.md`, `/@fs\\${VAULT}\\Home.md`, `/@fs/${enc(enc(v))}`, `/@fs/${enc(driveless)}/Home.md`,
    `/@fs/${a}/../../demo-vault`, `/@fs/../../demo-vault/Home.md`, `/@fs/../../../../../Windows/win.ini`, `/@fs/Windows/win.ini`, `/@fs/etc/passwd`,
    `/@fs/${a}%2f..%2f..%2fdemo-vault`, `/@fs/${a}%5c..%5c..%5cdemo-vault`, `/@fs/${a}/src/%2e/main.tsx`,
    `/@fs/${a}-evil/x`, `/@fs/${fwd(path.dirname(APP))}/x`, `/@fs/${fwd(path.resolve(APP, '..', '..'))}/README.md`,
    `/@fs/${v}/./Home.md`, `/@fs/${v}/Home.md%00`, '/@fs/%', '/@fs/%zz', '/@fs/\0', '/@fs',
    `/@fs/\\\\localhost\\c$\\x`, `/@fs//localhost/c$/Windows/win.ini`, '/@fs/\\\\?\\C:\\Windows\\win.ini', '/@fs/%5c%5c%3f%5cC%3a%5cWindows',
  ]
  assert.deepEqual(bad.filter((u) => !forbid(u)), [])
})

test('round3: ordinary dev-server URLs allowed', () => {
  for (const u of ['/', '/index.html', '/@vite/client', '/@id/react', '/@id/__x00__vite/preload-helper', '/@react-refresh', '/node_modules/.vite/deps/react.js?v=1',
    '/src/main.tsx', '/src/App.tsx?t=1', '/favicon.ico', '/api/graph', `/@fs/${a}/src/main.tsx?import`, `/@fs/${a}/node_modules/three/build/three.module.js?v=1`])
    assert.equal(forbid(u), false, u)
})

test('round3: non-/@fs traversal coverage report (diagnostic)', (t) => {
  const probes = [
    '/src/..%2f..%2fdemo-vault/Home.md', '/src/../../demo-vault/Home.md', '/..%2f..%2fdemo-vault/Home.md', '/../../demo-vault/Home.md', '/demo-vault/Home.md',
    '/src/..%5c..%5c..%5cdemo-vault%5cHome.md', '/%2e%2e/%2e%2e/demo-vault/Home.md', '/node_modules/.vite/../../../../demo-vault/Home.md', '/src/..%252f..%252fdemo-vault/Home.md',
    `/${driveless}/Home.md`, `/${v}/Home.md`, '/src/../../Windows/win.ini', '/..%2f..%2f..%2f..%2fWindows/win.ini', '/.env', '/.git/config', '/package.json',
  ]
  const notCovered = probes.filter((u) => !forbid(u))
  const covered = probes.filter((u) => forbid(u))
  t.diagnostic('COVERED by pure fn: ' + JSON.stringify(covered))
  t.diagnostic('NOT covered by pure fn: ' + JSON.stringify(notCovered))
  console.log('NOT-COVERED non-/@fs forms:\n  ' + notCovered.join('\n  '))
  console.log('COVERED non-/@fs forms:\n  ' + covered.join('\n  '))
  assert.ok(true)
})
