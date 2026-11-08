// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)
//
// MODIFIED 2026-11-07 for Connected AI Brain Lab project-only isolation
// (new file, not part of upstream v2.20.6 — see MODIFICATIONS).
//
// Pure request-guard helpers shared by the Express API and the Vite dev
// server: Host/Origin allow-lists, generic mutation blocking, exact-origin
// CORS headers, and the offline HTML transform. No express/vite imports.

import path from 'path'

export const SAFE_METHODS: readonly string[] = Object.freeze(['GET', 'HEAD', 'OPTIONS'])

export function isMutatingMethod(method: string | undefined): boolean {
  if (!method) return true
  return !SAFE_METHODS.includes(method.toUpperCase())
}

/** Exact, case-insensitive match against "host:port" entries. Lists, whitespace and missing values are rejected. */
export function isHostAllowed(host: string | undefined, allowedHostHeaders: readonly string[]): boolean {
  if (typeof host !== 'string' || host.length === 0) return false
  if (/[\s,]/.test(host)) return false
  return allowedHostHeaders.includes(host.toLowerCase())
}

/** A missing Origin is allowed (same-origin GET / non-browser); "null" and anything not listed exactly is rejected. */
export function isOriginAllowed(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (origin === undefined) return true
  if (typeof origin !== 'string') return false
  return allowedOrigins.includes(origin)
}

export interface GuardInput {
  method?: string
  host?: string
  origin?: string
  allowedHostHeaders: readonly string[]
  allowedOrigins: readonly string[]
}

export interface GuardVerdict {
  allow: boolean
  status: number
  reason?: string
}

export function evaluateRequest(input: GuardInput): GuardVerdict {
  if (!isHostAllowed(input.host, input.allowedHostHeaders)) {
    return { allow: false, status: 403, reason: 'Host not allowed' }
  }
  if (!isOriginAllowed(input.origin, input.allowedOrigins)) {
    return { allow: false, status: 403, reason: 'Origin not allowed' }
  }
  if (isMutatingMethod(input.method)) {
    return { allow: false, status: 403, reason: 'Read-only project mode: mutating requests are disabled' }
  }
  return { allow: true, status: 200 }
}

export const REFRESH_HEADER = 'x-jarvis-refresh'

/**
 * /api/graph/refresh is a state-changing GET: demand a same-origin signal
 * (Origin allowed if present, Sec-Fetch-Site same-origin/none if present) plus a
 * custom header that cross-site requests cannot add without a CORS preflight.
 */
export function checkRefreshRequest(input: {
  origin?: string
  secFetchSite?: string | string[]
  refreshHeader?: string | string[]
  allowedOrigins: readonly string[]
}): GuardVerdict {
  if (!isOriginAllowed(input.origin, input.allowedOrigins)) {
    return { allow: false, status: 403, reason: 'Origin not allowed' }
  }
  const site = input.secFetchSite
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    return { allow: false, status: 403, reason: 'Cross-site refresh not allowed' }
  }
  if (input.refreshHeader !== '1') {
    return { allow: false, status: 403, reason: 'Missing refresh header' }
  }
  return { allow: true, status: 200 }
}

function normalizeFsPath(p: string): string {
  let s = p.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
  s = s.replace(/^\/(?=[a-z]:)/, '')
  s = path.posix.normalize(s)
  return s.length > 1 ? s.replace(/\/$/, '') : s
}

function isUnderPosix(root: string, p: string): boolean {
  return p === root || p.startsWith(root + '/')
}

/** Non-source runtime artifacts that must never be served by the dev server (matched case-insensitively per path segment). */
export const DEV_DENY_SEGMENT_PATTERNS: readonly RegExp[] = Object.freeze([
  /\.(?:log|err|out|tsbuildinfo|pid|bak|orig|swp|tmp|env|pem|key)$/,
  /^optimization-log\.json$/,
  /^modifications(?:\.[a-z]+)?$/,
  /^\.?env(?:\.(?:local|development|production|staging|test|example|sample|[a-z]*\.local))?$/,
])

function isForbiddenDevSegment(seg: string, prev?: string): boolean {
  if (seg.length === 0) return false
  // Windows: NTFS alternate data streams ("name:stream") and trailing dots/spaces resolve to the base file
  const isDrive = /^[a-z]:$/i.test(seg)
  if (seg.includes(':') && !isDrive && prev !== '@id') return true
  if (/[. ]$/.test(seg)) return true
  const s = seg.toLowerCase()
  return DEV_DENY_SEGMENT_PATTERNS.some((re) => re.test(s))
}

/**
 * True when a dev-server URL must be refused: any /@fs/ request (raw, import,
 * query forms) that resolves outside appDir or under the vault, and any URL
 * whose decoded path mentions the vault. Fails closed on undecodable input.
 */
export function isForbiddenDevFsRequest(rawUrl: string | undefined, appDir: string, vaultPath: string): boolean {
  if (typeof rawUrl !== 'string') return true
  let p = rawUrl.split(/[?#]/, 1)[0]
  for (let i = 0; i < 5; i++) {
    let next: string
    try { next = decodeURIComponent(p) } catch { return true }
    if (next === p) break
    p = next
  }
  if (/%[0-9a-f]{2}/i.test(p)) return true
  if (p.includes('\0')) return true
  const folded = p.replace(/\\/g, '/')
  const segs = folded.split('/')
  if (segs.some((s) => s === '.' || s === '..')) return true
  if (segs.some((s, i) => s.startsWith('.') && s.length > 0 && !(s === '.vite' && segs[i - 1] === 'node_modules'))) return true
  if (segs.some((s, i) => isForbiddenDevSegment(s, segs[i - 1]))) return true
  const vaultName = normalizeFsPath(vaultPath).split('/').pop() ?? ''
  if (vaultName && folded.toLowerCase().includes(vaultName)) return true
  const norm = normalizeFsPath(p)
  const app = normalizeFsPath(appDir)
  const vault = normalizeFsPath(vaultPath)
  if (norm.includes(vault)) return true
  const m = /(?:^|\/)@fs(?:\/|$)/.exec(norm)
  if (!m) return false
  let target = normalizeFsPath(norm.slice(m.index + m[0].length))
  const appDrive = /^[a-z]:/.exec(app)
  if (appDrive && !/^[a-z]:/.test(target)) target = appDrive[0] + (target.startsWith('/') ? '' : '/') + target
  return !isUnderPosix(app, target) || isUnderPosix(vault, target)
}

/** CORS headers: only an exactly allowed Origin is echoed; never a wildcard. */
export function corsHeadersFor(origin: string | undefined, allowedOrigins: readonly string[]): Record<string, string> {
  const headers: Record<string, string> = { Vary: 'Origin' }
  if (origin !== undefined && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'Accept, Content-Type'
  }
  return headers
}

export function buildContentSecurityPolicy(uiPort: number): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ws://127.0.0.1:${uiPort} ws://localhost:${uiPort}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

/** Removes Google Fonts links and installs a restrictive CSP (system fonts are used instead). */
export function transformHtmlForProjectMode(html: string, uiPort: number): string {
  const stripped = html.replace(/<link\b[^>]*\b(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>\s*/gi, '')
  const meta = `<meta http-equiv="Content-Security-Policy" content="${buildContentSecurityPolicy(uiPort)}" />`
  return stripped.replace(/<head([^>]*)>/i, `<head$1>\n    ${meta}`)
}
