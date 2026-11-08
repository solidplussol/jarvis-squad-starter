// SPDX-License-Identifier: AGPL-3.0-only
// MODIFIED 2026-11-07 for Connected AI Brain Lab project-only isolation (new file; see MODIFICATIONS).
//
// Dependency-free test helper: lets plain `node` import the server's TypeScript
// modules, which use tsx-style "./x.js" specifiers that point at "./x.ts".
import { register } from 'node:module'

const hook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (err && err.code === 'ERR_MODULE_NOT_FOUND' && /^\\.{1,2}\\//.test(specifier) && specifier.endsWith('.js')) {
      return nextResolve(specifier.slice(0, -3) + '.ts', context)
    }
    throw err
  }
}
`
register('data:text/javascript,' + encodeURIComponent(hook))
