// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)
//
// MODIFIED 2026-11-07 for Connected AI Brain Lab project-only isolation
// (new file, not part of upstream v2.20.6 — see MODIFICATIONS).
//
// The ONE content-path policy. Every vault content read in isolation mode
// (GET /api/note, /api/config/validate, graph-worker directory walk and file
// reads) goes through this module. Node built-ins only.
//
// Policy: request paths are relative, '/'-separated (backslashes are folded to
// '/'), made of plain segments, end in .md, and every component on disk must
// be a real (non-symlink, non-junction) entry whose realpath stays inside the
// vault by path.relative containment.

import fs from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'

export const MAX_NOTE_BYTES = 5 * 1024 * 1024
const MAX_PATH_LENGTH = 1024
const MAX_WALK_DEPTH = 32

export class ContentPathError extends Error {
  readonly status: number
  constructor(message: string, status = 403) {
    super(message)
    this.name = 'ContentPathError'
    this.status = status
  }
}

const RESERVED_DEVICE = /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])(?:\..*)?$/i
const FORBIDDEN_CHARS = /[<>:"|?*\u0000-\u001f]/

/** Why a single path segment is not allowed, or null if it is fine. */
export function segmentProblem(seg: string): string | null {
  if (seg === '') return 'empty segment'
  if (seg === '.' || seg === '..') return 'dot segment'
  if (seg.startsWith('.')) return 'hidden entry'
  if (FORBIDDEN_CHARS.test(seg)) return 'forbidden character (NUL, control, drive/ADS colon or wildcard)'
  if (/[. ]$/.test(seg)) return 'trailing dot or space'
  if (RESERVED_DEVICE.test(seg)) return 'reserved device name'
  if (/~\d+(?:\.|$)/.test(seg)) return 'short (8.3) name'
  if (/%[0-9a-f]{2}/i.test(seg)) return 'percent-encoded sequence'
  return null
}

/** True when candidate is strictly inside root (or equal when allowEqual). Never prefix-based. */
export function isInside(root: string, candidate: string, allowEqual = false): boolean {
  const rel = path.relative(root, candidate)
  if (rel === '') return allowEqual
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)
}

/**
 * Validates a client-supplied note path and returns its normalized segments.
 * Pure string checks only — touches no filesystem.
 */
export function validateRelativeNotePath(input: unknown): string[] {
  if (typeof input !== 'string' || input.length === 0) throw new ContentPathError('path required', 400)
  if (input.length > MAX_PATH_LENGTH) throw new ContentPathError('path too long', 400)
  if (input.includes('\0')) throw new ContentPathError('NUL byte in path')
  if (/^[\\/]/.test(input)) throw new ContentPathError('absolute or UNC path not allowed')
  if (/^[a-zA-Z]:/.test(input)) throw new ContentPathError('drive prefix not allowed')
  const segments = input.split(/[\\/]/)
  for (const seg of segments) {
    const problem = segmentProblem(seg)
    if (problem) throw new ContentPathError(`path rejected: ${problem}`)
  }
  if (!/\.md$/.test(segments[segments.length - 1])) throw new ContentPathError('only .md notes are readable')
  return segments
}

function realRoot(vaultRoot: string): string {
  return fs.realpathSync.native(vaultRoot)
}

/**
 * Verifies an absolute path against the vault: contained by relative(), every
 * segment valid, every component an lstat-verified non-symlink, final entry a
 * regular file, and realpath still inside. Returns the verified path.
 */
export function verifyNotePathSync(rootReal: string, absPath: string): string {
  if (!isInside(rootReal, absPath)) throw new ContentPathError('path escapes the vault')
  const segments = path.relative(rootReal, absPath).split(path.sep)
  for (const seg of segments) {
    const problem = segmentProblem(seg)
    if (problem) throw new ContentPathError(`path rejected: ${problem}`)
  }
  if (!/\.md$/.test(segments[segments.length - 1])) throw new ContentPathError('only .md notes are readable')

  let cur = rootReal
  for (let i = 0; i < segments.length; i++) {
    cur = path.join(cur, segments[i])
    let st: fs.Stats
    try {
      st = fs.lstatSync(cur)
    } catch {
      throw new ContentPathError('Note not found', 404)
    }
    if (st.isSymbolicLink()) throw new ContentPathError('symlinks and junctions are not allowed')
    const last = i === segments.length - 1
    if (last && !st.isFile()) throw new ContentPathError('not a regular file')
    if (!last && !st.isDirectory()) throw new ContentPathError('not a directory')
  }
  let real: string
  try {
    real = fs.realpathSync.native(cur)
  } catch {
    throw new ContentPathError('Note not found', 404)
  }
  if (!isInside(rootReal, real)) throw new ContentPathError('path escapes the vault')
  return cur
}

/** Resolves a client note path to a verified absolute path inside the vault. */
export function resolveNotePath(vaultRoot: string, requested: unknown): string {
  const segments = validateRelativeNotePath(requested)
  const root = realRoot(vaultRoot)
  return verifyNotePathSync(root, path.join(root, ...segments))
}

export interface NoteFile {
  content: string
  mtime: Date
  birthtime: Date
}

/**
 * Opens first, then re-verifies (check-then-use race): after open the path must
 * still be a non-symlink whose realpath is inside the vault and whose identity
 * (dev/ino) matches the opened descriptor.
 */
export function readVerifiedNote(rootReal: string, absPath: string): NoteFile {
  const verified = verifyNotePathSync(rootReal, absPath)
  const fd = fs.openSync(verified, 'r')
  try {
    const fst = fs.fstatSync(fd, { bigint: true })
    if (!fst.isFile()) throw new ContentPathError('not a regular file')
    if (fst.size > BigInt(MAX_NOTE_BYTES)) throw new ContentPathError('note too large', 413)
    const after = verifyNotePathSync(rootReal, verified)
    const lst = fs.lstatSync(after, { bigint: true })
    if (lst.ino !== fst.ino || lst.dev !== fst.dev) throw new ContentPathError('file changed while opening')
    const content = fs.readFileSync(fd, 'utf-8')
    return {
      content,
      mtime: new Date(Number(fst.mtimeMs)),
      birthtime: new Date(Number(fst.birthtimeMs)),
    }
  } finally {
    fs.closeSync(fd)
  }
}

/** Reads a note for a client-supplied relative path (GET /api/note). */
export function readNoteSafe(vaultRoot: string, requested: unknown): { content: string; path: string } {
  const root = realRoot(vaultRoot)
  const segments = validateRelativeNotePath(requested)
  const note = readVerifiedNote(root, path.join(root, ...segments))
  return { content: note.content, path: segments.join('/') }
}

export interface WalkResult {
  files: string[]
  skipped: number
}

/**
 * Walks the vault for .md files without ever following a symlink/junction,
 * skipping hidden and policy-violating names, and staying inside the vault.
 */
export async function walkMarkdownFiles(vaultRoot: string): Promise<WalkResult> {
  // Native realpath so the walk root matches verifyNotePathSync's root exactly
  const realpathNative = (p: string) =>
    new Promise<string>((resolve, reject) => fs.realpath.native(p, (err, r) => (err ? reject(err) : resolve(r))))
  const root = await realpathNative(vaultRoot)
  const files: string[] = []
  let skipped = 0

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_WALK_DEPTH) { skipped++; return }
    let entries: fs.Dirent[]
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true })
    } catch {
      skipped++
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink() || segmentProblem(entry.name) !== null || !isInside(root, full)) {
        skipped++
        continue
      }
      if (entry.isDirectory()) {
        let realDir: string
        try {
          realDir = await realpathNative(full)
        } catch {
          skipped++
          continue
        }
        if (realDir !== full && !isInside(root, realDir)) { skipped++; continue }
        await walk(full, depth + 1)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(full)
      }
    }
  }

  await walk(root, 0)
  return { files, skipped }
}

/** Counts .md files for /api/config/validate using the same walk. */
export async function countMarkdownFiles(vaultRoot: string): Promise<number> {
  return (await walkMarkdownFiles(vaultRoot)).files.length
}
