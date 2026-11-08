// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)
//
// MODIFIED 2026-11-07 for Connected AI Brain Lab project-only isolation
// (new file, not part of upstream v2.20.6 — see MODIFICATIONS).
//
// Shared configuration resolver. Decides between upstream behaviour and
// project-only isolation, and in isolation mode is the ONLY source of vault,
// port, bind-host and allowed-root decisions for server/index.ts,
// server/embeddings.ts and vite.config.ts.
//
// Isolation mode (JARVIS_PROJECT_MODE=1):
//   - never reads ~/.jarvis-config.yaml, JARVIS_VAULT_PATH, VAULT_PATH,
//     VITE_VAULT_PATH, .env files, or anything under the user's home directory
//   - requires JARVIS_PROJECT_VAULT to be exactly the project demo-vault path
//   - fails closed (throws ProjectConfigError) before any worker/server starts
//
// This module is dependency-free (node built-ins only) so it can be unit tested.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

export const MODE_ENV = 'JARVIS_PROJECT_MODE'
export const VAULT_ENV = 'JARVIS_PROJECT_VAULT'
export const API_PORT_ENV = 'JARVIS_PROJECT_API_PORT'
export const UI_PORT_ENV = 'JARVIS_PROJECT_UI_PORT'

export const BIND_HOST = '127.0.0.1'
export const DEFAULT_API_PORT = 3002
export const DEFAULT_UI_PORT = 5173
export const LOOPBACK_HOSTNAMES: readonly string[] = Object.freeze(['127.0.0.1', 'localhost'])

// Everything the isolation mode switches off. Asserted by tests; consumers
// must branch on project mode rather than read these as user settings.
export const DISABLED_FEATURES = Object.freeze({
  globalConfig: false,
  vaultWatcher: false,
  vaultWrites: false,
  configWrites: false,
  embeddings: false,
  speech: false,
  modelDownloads: false,
  communityShapes: false,
  externalFonts: false,
  wildcardCors: false,
})

export const DEFAULT_APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export class ProjectConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectConfigError'
  }
}

export interface ResolverFs {
  lstatSync(p: string): fs.Stats
  realpathSync(p: string): string
}

const realFs: ResolverFs = {
  lstatSync: (p) => fs.lstatSync(p),
  realpathSync: (p) => fs.realpathSync.native(p),
}

export type Env = Readonly<Record<string, string | undefined>>

export interface ResolveOptions {
  env?: Env
  /** Directory containing package.json (vendor/jarvis). Defaults to this module's parent. */
  appDir?: string
  /** Allowed vault path. Defaults to <appDir>/../../demo-vault. */
  allowedVault?: string
  /** Filesystem used for validation; tests inject a spy. */
  fs?: ResolverFs
}

export interface ProjectConfig {
  readonly mode: 'project'
  readonly appDir: string
  readonly vaultPath: string
  readonly allowedRoots: readonly string[]
  readonly bindHost: string
  readonly apiPort: number
  readonly uiPort: number
  readonly apiHostHeaders: readonly string[]
  readonly uiHostHeaders: readonly string[]
  readonly allowedOrigins: readonly string[]
  readonly features: typeof DISABLED_FEATURES
}

export type ResolvedConfig = { readonly mode: 'upstream' } | ProjectConfig

/**
 * True when isolation mode is requested. Throws on ambiguous values so a typo
 * can never silently fall back to upstream (global-config) behaviour.
 */
export function projectModeRequested(env: Env = process.env): boolean {
  const raw = env[MODE_ENV]
  if (raw === '1') return true
  if (raw === '0') return false
  if (raw === undefined || raw === '') {
    const vault = env[VAULT_ENV]
    if (vault !== undefined && vault !== '') {
      throw new ProjectConfigError(`${VAULT_ENV} is set but ${MODE_ENV}=1 is not; refusing to guess the mode.`)
    }
    return false
  }
  throw new ProjectConfigError(`${MODE_ENV} must be "1" (isolated) or "0"/unset (upstream); got ${JSON.stringify(raw)}.`)
}

function trimTrailingSeparators(p: string): string {
  const root = path.parse(p).root
  let out = p
  while (out.length > root.length && /[\\/]$/.test(out)) out = out.slice(0, -1)
  return out
}

/** True when `candidate` is `root` itself or strictly inside it (path.relative based, no prefix matching). */
export function isInsideOrEqual(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  if (rel === '') return true
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)
}

export function parsePort(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  if (!/^\d{1,5}$/.test(raw)) throw new ProjectConfigError(`${name} must be an integer port, got ${JSON.stringify(raw)}.`)
  const n = Number(raw)
  if (n < 1024 || n > 65535) throw new ProjectConfigError(`${name} must be between 1024 and 65535, got ${n}.`)
  return n
}

/**
 * Validates the supplied vault string against the single allowed vault path.
 * Returns the canonical (realpath) vault path. Pure string checks run before
 * any filesystem access; no fallback of any kind.
 */
export function validateProjectVault(
  supplied: string | undefined,
  allowedVault: string,
  projectRoot: string,
  fsApi: ResolverFs = realFs,
): string {
  if (typeof supplied !== 'string' || supplied.length === 0) {
    throw new ProjectConfigError(`${VAULT_ENV} is required in project mode and must be exactly: ${allowedVault}`)
  }
  const bad = (why: string): never => {
    throw new ProjectConfigError(`${VAULT_ENV} rejected (${why}). It must be exactly: ${allowedVault}`)
  }
  if (supplied !== supplied.trim()) bad('leading/trailing whitespace')
  if (supplied.includes('\0')) bad('NUL byte')
  if (/^[\\/]{2}/.test(supplied)) bad('UNC or device path')
  if (!path.isAbsolute(supplied)) bad('not an absolute path')
  if (/(^|[\\/])\.\.?([\\/]|$)/.test(supplied)) bad('dot segments')
  if (supplied.replace(/^[a-zA-Z]:/, '').includes(':')) bad('alternate data stream or invalid colon')

  const expected = trimTrailingSeparators(path.normalize(allowedVault))
  const given = trimTrailingSeparators(path.normalize(supplied))
  if (given !== expected) bad('different path')

  let lst: fs.Stats
  try {
    lst = fsApi.lstatSync(expected)
  } catch {
    return bad('does not exist')
  }
  if (lst.isSymbolicLink()) bad('vault directory is a symlink/junction')
  if (!lst.isDirectory()) bad('not a directory')

  let real: string
  let realAllowed: string
  let realRoot: string
  try {
    real = fsApi.realpathSync(supplied)
    realAllowed = fsApi.realpathSync(expected)
    realRoot = fsApi.realpathSync(projectRoot)
  } catch {
    return bad('cannot be resolved')
  }
  if (real !== realAllowed) bad('realpath differs from the allowed vault')
  if (!isInsideOrEqual(realRoot, real) || real === realRoot) bad('resolves outside the project')
  return real
}

export function resolveConfig(opts: ResolveOptions = {}): ResolvedConfig {
  const env = opts.env ?? process.env
  if (!projectModeRequested(env)) return Object.freeze({ mode: 'upstream' as const })

  const fsApi = opts.fs ?? realFs
  const appDirRaw = path.resolve(opts.appDir ?? DEFAULT_APP_DIR)
  const projectRoot = path.resolve(appDirRaw, '..', '..')
  const allowedVault = opts.allowedVault ?? path.join(projectRoot, 'demo-vault')

  const apiPort = parsePort(API_PORT_ENV, env[API_PORT_ENV], DEFAULT_API_PORT)
  const uiPort = parsePort(UI_PORT_ENV, env[UI_PORT_ENV], DEFAULT_UI_PORT)
  if (apiPort === uiPort) throw new ProjectConfigError('API and UI ports must differ.')

  const vaultPath = validateProjectVault(env[VAULT_ENV], allowedVault, projectRoot, fsApi)
  let appDir: string
  try {
    appDir = fsApi.realpathSync(appDirRaw)
  } catch {
    throw new ProjectConfigError('Application directory cannot be resolved.')
  }

  const hostHeaders = (port: number) => LOOPBACK_HOSTNAMES.map((h) => `${h}:${port}`)
  const origins = [uiPort, apiPort].flatMap((port) => LOOPBACK_HOSTNAMES.map((h) => `http://${h}:${port}`))

  return Object.freeze({
    mode: 'project' as const,
    appDir,
    vaultPath,
    allowedRoots: Object.freeze([appDir, vaultPath]),
    bindHost: BIND_HOST,
    apiPort,
    uiPort,
    apiHostHeaders: Object.freeze(hostHeaders(apiPort)),
    uiHostHeaders: Object.freeze(hostHeaders(uiPort)),
    allowedOrigins: Object.freeze(origins),
    features: DISABLED_FEATURES,
  })
}

/** Vite dev-server options for project mode (loopback only, strict port, strict fs). */
export function buildViteServerOptions(cfg: ProjectConfig) {
  return {
    host: cfg.bindHost,
    port: cfg.uiPort,
    strictPort: true,
    open: false,
    allowedHosts: [...LOOPBACK_HOSTNAMES],
    cors: { origin: [...cfg.allowedOrigins] },
    // App dir only: the vault is reached exclusively via /api/note (content-path policy)
    fs: { strict: true, allow: [cfg.appDir] },
    proxy: {
      '/api': { target: `http://${cfg.bindHost}:${cfg.apiPort}`, changeOrigin: true },
    },
  }
}

/** Vite preview-server options for project mode. */
export function buildVitePreviewOptions(cfg: ProjectConfig) {
  return {
    host: cfg.bindHost,
    port: cfg.uiPort,
    strictPort: true,
    open: false,
    allowedHosts: [...LOOPBACK_HOSTNAMES],
    cors: { origin: [...cfg.allowedOrigins] },
    proxy: {
      '/api': { target: `http://${cfg.bindHost}:${cfg.apiPort}`, changeOrigin: true },
    },
  }
}
