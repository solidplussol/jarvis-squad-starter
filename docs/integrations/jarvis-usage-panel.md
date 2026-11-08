# Jarvis optional usage panel

An **optional, off-by-default** "USAGE" panel in the Jarvis Mission view. It shows *recorded* token usage taken from the local Copilot session store. It is not live, shows no dollar amounts and contains no GitHub billing data.

## Why it is local-only

- Jarvis stays read-only: it holds no credentials or tokens, makes no outbound calls, and reads two fixed allow-listed files (the opt-in flag `.local/usage-panel.json` and the summary `.local/usage-summary.json`).
- The data comes from a **user-run script** (`scripts/usage-summary.mjs`) that reads only aggregate columns of the local Copilot session store and writes the summary file. Jarvis never touches the store.
- GitHub billing (spend / remaining premium requests) is deliberately left out: it needs live-account credentials, which this project does not give Jarvis. The panel therefore always shows `GitHub spend/remaining: Unknown (not configured)`. Implementing it would be a separate, future milestone using credentials supplied by the repository owner, with its own security review.

## Turn it on

From the repository root (PowerShell):

```powershell
New-Item -ItemType Directory .local -Force | Out-Null
'{"enabled": true}' | Set-Content .local\usage-panel.json -Encoding ascii
node scripts\usage-summary.mjs          # Node 24 recommended (built-in node:sqlite); creates .local\usage-summary.json
```

Then start (or reload) Jarvis as described in `jarvis-project-isolation.md`. The "USAGE" button appears next to AGENTS/KANBAN; use its Refresh button after re-running the script. Re-run the script whenever you want fresh numbers (the panel flags a summary older than 24 hours as STALE).

## Turn it off

```powershell
Remove-Item .local\usage-panel.json
```

With no file, an invalid file, or anything other than `"enabled": true`, `GET /api/usage` returns only `{"enabled":false}` and the UI renders no Usage button or panel. `.local/` is git-ignored; the summary is never committed. Delete `.local\usage-summary.json` too if you do not want the data kept.

## What the script reads and writes

Reads (opened **read-only** via built-in `node:sqlite`; no dependencies, no network, no credential or config files): the Copilot session store at `$COPILOT_HOME\session-store.db`, or `~\.copilot\session-store.db` by default.

- `assistant_usage_events`: `model`, `agent_id`, `parent_tool_call_id` (only whether it is present), `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens`, `request_multiplier`, `created_at`.
- `sessions`: `id` (join) and `cwd` (project filter) only. Only sessions whose `cwd` **exactly** equals this project folder (case-insensitive, trailing slash ignored) are counted; sessions started in a subdirectory of the project are excluded.
- It never selects message/prompt/summary/user_message/assistant_response, files, refs or checkpoint columns, and it logs only counts.

If the store is missing, unreadable or has an unexpected schema, the script exits non-zero with a short message and writes nothing. If the store path is outside your home folder (for example via `COPILOT_HOME` or `--db`) it still runs but prints a warning.

Writes: `.local\usage-summary.json` as **compact** (not pretty-printed) JSON, via a temp file and atomic rename; the temp file is removed if the rename fails. `--out` must be a file inside `<project>\.local` (anything else is refused and nothing is written). The script shrinks the bucket cap (50, 40, 30, 20, 10, 4) if needed so the file stays under 60 KB, below the server's 64 KB limit.

Periods: last 24 hours, last 7 days, all time (fixed windows, not configurable).

## What the server reads and exposes

`GET /api/usage` (GET only; Host/Origin guards apply; mutations stay 403; no query or path parameters) reads exactly two fixed files with the same safe reader as the agents roster: no symlinks/junctions/hardlinks, realpath contained in the project, regular file, 64 KB cap. It parses the summary and validates it strictly (types, integer and numeric bounds, string length caps, at most 50 buckets, label/note sanitiser shared with the roster, labels/notes that look like file paths rejected). Any violation, including an oversized (> 64 KB) file, yields `{"enabled":true,"available":false,"reason":"The usage summary is not valid and was ignored."}` (a missing summary gets a separate "No usage summary found" reason); unexpected errors give a fixed `500 {"error":"usage unavailable"}`. No absolute paths, raw file text or stack traces are returned. Unknown fields are dropped.

Returned fields: `enabled`, `available`, `generatedAt`, `ageSeconds` (computed), `stale` (> 24 h), `source`, `attribution`, `periods.{last_24h,last_7d,all_time}.{totals,buckets}`, `buckets`, `notes`, `githubSpend: null`, `githubRemaining: null`.

The Vite dev server's deny-list continues to refuse `/@fs/` access and any dot-directory such as `.local` (covered by `vendor\jarvis\tests\isolation\usage-summary.test.mjs`).

## Summary file schema (`.local\usage-summary.json`, schema_version 1)

| Field | Meaning |
|---|---|
| `schema_version` | Must be `1`. |
| `generated_at` | ISO-8601 time the script ran. |
| `source` | Must be `local-copilot-session-store`. |
| `attribution` | `partial`, `none` or `proven`. The script writes `partial`. |
| `periods` | `last_24h`, `last_7d`, `all_time`; each has `totals` and `buckets`. |
| `buckets` | All-time buckets (same as `periods.all_time.buckets`), max 50. |
| bucket / totals | `events` (usage events), `runs` (distinct subagent ids; 0 for main thread), `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens`, `request_multiplier_sum`. Buckets also have `label` and `kind` (`main`, `subagent`, `other`). |
| `notes` | Up to 10 short plain-text notes. |
| `github_spend`, `github_remaining` | Must be `null` (not implemented). |

`request_multiplier_sum` is the **premium-request multiplier** recorded per call. It is **not dollars**.

## Script options and variables

| Name | Purpose | Default | Required |
|---|---|---|---|
| `COPILOT_HOME` (env) | Folder containing `session-store.db` | `~\.copilot` | No |
| `--db <file>` | Store path override (mainly for tests) | as above | No |
| `--project <dir>` | Project folder used as the `cwd` filter | repository root | No |
| `--out <file>` | Output path override; must be inside `<project>\.local` (the server only reads the default path) | `.local\usage-summary.json` | No |

Jarvis project environment variables (see `jarvis-project-isolation.md`):

| Name | Purpose | Default | Required |
|---|---|---|---|
| `JARVIS_PROJECT_MODE` | Enables project-only isolation mode (the usage endpoint exists only in this mode) | unset | Yes (`1`) |
| `JARVIS_PROJECT_VAULT` | Must be exactly the project `demo-vault` path | none | Yes |
| `JARVIS_PROJECT_API_PORT` | API port | `3002` (demo launched with `3102`) | No |
| `JARVIS_PROJECT_UI_PORT` | UI (Vite) port | `5173` (demo launched with `5273`) | No |

Config file keys: `.local\usage-panel.json` has one key, `enabled` (boolean; only `true` turns the feature on; other keys are ignored).

## Attribution

The store records opaque subagent ids, not specialist names, and no non-content field links an id to a name. Names would only be recoverable by reading message or checkpoint content, which the script does not do. Buckets are therefore `Main thread` (no `agent_id`) and `Subagent runs (not attributed to a specialist)`, each split by model. Attribution is reported as `partial`. Names are never guessed.

## Extending it

You are free to extend this, for example with your own collector for GitHub billing or another provider, as long as the contract stays the same: **a separate user-run script writes the validated summary file and Jarvis only reads it**. Preserve:

- the schema (add fields only together with a matching server whitelist change),
- the 64 KB size cap and the fixed-file, no-client-path read,
- no secrets, tokens or credentials in the summary file,
- sanitised labels and notes (plain text, length-capped, no paths or markup),
- no network calls and no credentials inside Jarvis itself.

Any extension (especially one touching billing or credentials) should get a security review before use.

## Limitations

- Recorded, not live; numbers are as of the last script run.
- Attribution is partial (no specialist names).
- Multipliers are not dollars; no cost is computed.
- GitHub spend/remaining are not implemented and shown as Unknown.
- The local store schema is not a documented API and may change; the script then fails safely and writes nothing.
- Read-only: Jarvis never writes any of these files.
