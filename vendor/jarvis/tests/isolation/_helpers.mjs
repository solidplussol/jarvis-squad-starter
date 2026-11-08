// SPDX-License-Identifier: AGPL-3.0-only
// MODIFIED 2026-11-07 for Connected AI Brain Lab project-only isolation (new file; see MODIFICATIONS).
//
// Shared fixtures for the isolation tests. Everything is created inside a
// project-local temp directory (never the OS temp dir, never the real vault
// or home) and removed by cleanup().
import './register-ts.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const HERE = path.dirname(fileURLToPath(import.meta.url))
export const APP_DIR = path.resolve(HERE, '..', '..')
export const SERVER_DIR = path.join(APP_DIR, 'server')

export function serverModule(name) {
  return import(new URL(`../../server/${name}`, import.meta.url).href)
}

/** <tmp>/project/{vendor/jarvis, demo-vault, other-vault}, <tmp>/home-canary/.jarvis-config.yaml */
export function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(HERE, 'tmp-iso-'))
  const root = path.join(tmp, 'project')
  const appDir = path.join(root, 'vendor', 'jarvis')
  const vault = path.join(root, 'demo-vault')
  const other = path.join(root, 'other-vault')
  const outside = path.join(tmp, 'outside')
  const home = path.join(tmp, 'home-canary')
  for (const d of [appDir, vault, other, outside, home, path.join(vault, 'notes', 'deep')]) {
    fs.mkdirSync(d, { recursive: true })
  }
  fs.writeFileSync(path.join(vault, 'Home.md'), '# Home\nlinks [[Deep]]\n')
  fs.writeFileSync(path.join(vault, 'notes', 'deep', 'Deep.md'), '# Deep\n')
  fs.writeFileSync(path.join(vault, 'notes', 'readme.txt'), 'not markdown')
  fs.writeFileSync(path.join(outside, 'secret.md'), '# SECRET OUTSIDE\n')
  fs.writeFileSync(path.join(other, 'Other.md'), '# Other\n')
  const canaryConfig = path.join(home, '.jarvis-config.yaml')
  fs.writeFileSync(canaryConfig, `vault:\n  path: ${other}\nserver:\n  port: 4999\n`)
  return {
    tmp, root, appDir, vault, other, outside, home, canaryConfig,
    env(extra = {}) {
      return {
        JARVIS_PROJECT_MODE: '1',
        JARVIS_PROJECT_VAULT: vault,
        HOME: home,
        USERPROFILE: home,
        VAULT_PATH: other,
        JARVIS_VAULT_PATH: other,
        VITE_VAULT_PATH: other,
        ...extra,
      }
    },
    cleanup() {
      fs.rmSync(tmp, { recursive: true, force: true })
    },
  }
}

/** Try to create a symlink/junction; returns false when the platform/privilege forbids it. */
export function tryLink(target, linkPath, kind) {
  try {
    fs.symlinkSync(target, linkPath, kind)
    return true
  } catch {
    return false
  }
}
