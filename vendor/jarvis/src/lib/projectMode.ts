// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)
//
// MODIFIED 2026-11-07 for Connected AI Brain Lab project-only isolation
// (new file, not part of upstream v2.20.6 — see MODIFICATIONS).
//
// Build-time flag injected by vite.config.ts from the shared server resolver.
// It is a compile-time constant, so it is not user-editable at runtime and is
// also available inside web workers.

export const PROJECT_MODE: boolean =
  typeof __JARVIS_PROJECT_MODE__ !== 'undefined' && __JARVIS_PROJECT_MODE__ === true
