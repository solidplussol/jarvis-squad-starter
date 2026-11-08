# Jarvis project-only isolation mode

Vendored at `vendor/jarvis` from Prompt-Surfer/obsidian-jarvis-ui tag **v2.20.6**, commit
**`0d2eca1ff19d896e0f558184416574ffcde4389c`** (AGPL-3.0-only, LICENSE unchanged). Upstream
`package.json` says 2.16.1 – an upstream discrepancy, recorded and not fixed. Changes are listed in
`vendor/jarvis/MODIFICATIONS` (modified 2026-11-07).

## Status and verification
- Dependencies were installed once with `npm ci --ignore-scripts` in `vendor/jarvis` (595 packages, Vite 5.4.21, vitest 4.0.18). `package.json` and `package-lock.json` hashes were unchanged by the install. `npm audit` was not run and no fixes were applied (npm reported 45 advisories, not triaged).
- Isolation tests: `node --test "tests/isolation/*.test.mjs"` – 48 tests, 47 pass, 0 fail, 1 skipped (file-symlink test; no privilege to create file symlinks). `vitest run` (project-mode env) passes the single upstream suite (26 tests). `tsc --noEmit -p tsconfig.node.json` shows 5 errors, all in unmodified upstream lines; `tsconfig.app.json` shows 4, all in unmodified `force3d.worker.ts`.
- The patched app was launched under supervision (Verification and Integration) on ports **3102/5273**, because 3002/5173 were held by an unrelated, pre-existing Jarvis copy that was not touched. Runtime checks passed: loopback-only bind, Host/Origin enforcement, mutation requests 403, `/@fs/` and traversal blocking, HMR WebSocket token/Origin guard, and the graph (7 demo notes, 16 unique links, which is the 22 wikilink occurrences deduplicated as undirected pairs by upstream's unchanged link logic).

## What the mode does
Activated by `JARVIS_PROJECT_MODE=1`. Read-only, loopback-only, offline:

- Reads no user-global Jarvis config (`~/.jarvis-config.yaml`, `~/.jarvis-embeddings.json`) and scans no Documents/Obsidian folders.
- Vault must be exactly `<project>/demo-vault` (realpath-equal). Anything else exits with code 2 before workers, graph build, servers or embeddings start. No fallback.
- One content-path policy (`server/content-path.ts`) for every content read: no traversal, absolute/UNC/drive paths, NUL, ADS, device names, symlinks/junctions, non-`.md`.
- API on `127.0.0.1:3002`, Vite on `127.0.0.1:5173` by default (strict ports, overridable), Host and Origin allow-lists, no wildcard CORS, Vite `fs.strict` with `fs.allow` limited to the app dir.
- POST/PUT/PATCH/DELETE return 403 (`/api/note`, `/api/config` included). Editor is read-only.
- No embeddings/speech/model download, no community (Casberry/Firestore) features, no Google Fonts, no vault watcher. Remote images and external links in notes are blocked.
- Manual refresh: `GET /api/graph/refresh` (Settings > "Refresh Graph"). Because it is a state-changing GET it requires an allowed-or-absent `Origin`, `Sec-Fetch-Site` of `same-origin`/`none` if present, and the header `X-Jarvis-Refresh: 1`.
- Vite `fs.allow` is the app dir only; the vault is reachable only through `/api/note`. A dev-server middleware returns 403 for any `/@fs/` URL (raw/import/query, percent-encoded, backslash, mixed-case variants) that is outside the app dir or under the vault.

## Precedence (project mode)
1. `JARVIS_PROJECT_MODE` (`1` = isolated, `0`/unset = upstream; other values error).
2. `JARVIS_PROJECT_VAULT` – required, must equal the demo-vault path.
3. `JARVIS_PROJECT_API_PORT` / `JARVIS_PROJECT_UI_PORT` (1024–65535, distinct) else 3002 / 5173.

Ignored: YAML config, `JARVIS_VAULT_PATH`, `VAULT_PATH`, `VITE_VAULT_PATH`, `.env`. Outside the mode the upstream order (YAML, then env fallbacks) is unchanged. Setting `JARVIS_PROJECT_VAULT` without `JARVIS_PROJECT_MODE=1` is an error, so isolation cannot silently fall through.

## Launch (from `vendor/jarvis`; dependencies are installed via `npm ci --ignore-scripts`)
```powershell
$env:JARVIS_PROJECT_MODE = '1'
$env:JARVIS_PROJECT_VAULT = '<repo-root>\demo-vault'
# optional: $env:JARVIS_PROJECT_API_PORT = '3102'; $env:JARVIS_PROJECT_UI_PORT = '5273'
npx tsx server/index.ts      # API
npx vite                     # UI (second terminal, same env)
```
Always run `vite`, `vitest` and `tsx` with these variables set. Without `JARVIS_PROJECT_MODE=1` the vendored `vite.config.ts` falls back to upstream behaviour and reads `~/.jarvis-config.yaml`.
Ports 3002/5173 are defaults; if they are taken, override them (both servers must see the same values), e.g. `$env:JARVIS_PROJECT_API_PORT='3102'; $env:JARVIS_PROJECT_UI_PORT='5273'`. Ports are strict: a busy port is an error, not a fallback.
Do not use `scripts/` or the playwright tests; they are unmodified upstream probes.

## Agents panel (read-only)
`GET /api/agents` (project mode only, behind the Host/Origin guards; mutations stay 403) feeds an "AGENTS" panel in the UI
(`src/components/AgentsPanel.tsx`, manual Refresh, plain text, no polling). Logic lives in `server/agents-roster.ts`, a
separate narrow read boundary (lstat/realpath containment, no symlinks/junctions, 64 KB cap, capped plain-text fields).
It opens ONLY these records under the project root: the three fixed files `.squad/team.md`, `.squad/casting/registry.json`,
`.squad/identity/now.md`, plus, for each roster member validated below, `.squad/agents/<id>/charter.md` (name/role/Deliverables
line only) and `docs/status/<id>.md` (at most 3 + 2x20 = 43 files; no globbing, no directory listing to discover members).
Histories, prompts/spawn templates, config, credentials, decisions, inbox, memory and full charters are never read.
Entries are parsed tolerantly (malformed ones are skipped and counted, never shown), capped at the latest 20 per agent, and
sanitised to plain text. Format in `docs/status/README.md`.

**Dynamic roster.** The roster is whatever squad is in the repo, not a fixed list. Members are the rows of the `## Members`
table in `.squad/team.md` (the table needs a header row with a `Name` column; `Role` and `Status` columns are found by header;
extra columns, bold/backticks, CRLF and missing outer pipes are tolerated). `.squad/casting/registry.json` is cross-checked: a
member whose registry `agents.<id>.status` is `retired` (or whose team.md Status starts with "retired") is excluded; the registry
cannot add members. Built-in support agents (scribe, ralph, rai, fact-checker) appear only if listed in that Members table.
If `team.md` is missing, unparseable or yields no members, the roster is empty with a `rosterReason` starting "No roster found";
Jarvis never guesses from processes or directory listings.

**Name validation.** Each name must be ASCII letters/digits/spaces/hyphens, starting and ending with a letter or digit (checked
before lowercasing, so Unicode lookalikes such as U+212A are rejected). Spaces become hyphens, the result is lowercased and must
match `^[a-z0-9][a-z0-9-]{0,39}$` and not be a reserved name (Windows devices con, prn, aux, nul, com0-9, lpt0-9, and `readme`). The RAW cell text is validated, so markdown characters are not stripped first: `a_b` is rejected, not mapped to `ab`; only a balanced outer `**bold**` or backtick wrapper is unwrapped. Dots, slashes,
backslashes, colons/drive letters, trailing dots/spaces and non-ASCII are rejected and skipped. At most 20 members are kept.
`skippedCount` reports invalid, over-cap and retired entries without echoing any raw name. Paths are built only from validated
ids into the fixed templates above, then pass the same lstat/realpath/reparse-point containment and 64 KB checks.

State label per agent: `last_reported` (at least one valid saved entry; shown as "Last reported: <status> (reported <time>)",
never as live), `configured` (roster member, no entries), `unknown` (record unreadable or only malformed entries),
`running` (never emitted: Squad exposes no supported way to observe current execution).
Response has `liveStatusAvailable: false`, a `limitation` text, `rosterSource`, `rosterReason` (null when a roster was found),
`skippedCount` and `allowedRecords` (project-relative). Task, blocker, next action, deliverable and evidence come from
the latest entry ("none recorded" if absent). The record's `Reported` time and the file's modified time are exposed and shown
separately, each labelled with its source. `retrospective` entries are labelled "Retrospective summary" and may have an unknown time.
A status entry's `Agent` must equal the member id of its file, else it is skipped; if that leaves no valid entry (observed behaviour) the card shows Unknown. Members with no status file show Configured. If building the roster throws, `/api/agents` returns a fixed 500 `{"error":"roster unavailable"}` (no stack or paths). Record files with more than one hard link are not read.

Limits: the roster depends on the `team.md` table format; Jarvis requires squads to follow `docs/status/README.md`, and the status/Kanban views depend on specialists following
`docs/status/README.md` (otherwise members show Configured with no updates). An unparseable roster shows nothing.
Not browser-verified (served and fetched over HTTP only). Tests: `tests/isolation/agents-roster.test.mjs`, `tests/isolation/dynamic-roster.test.mjs`.

## Kanban (read-only)
`GET /api/agents` also returns `kanban` (no extra file reads; same dynamic allow-list), shown by the "KANBAN" button (`src/components/KanbanPanel.tsx`; manual Refresh, plain text, no drag/drop or editing). Assumption: tasks are reconstructed from recorded status updates only; nothing is inferred or simulated. A task is agent + Task ID; its column is its latest valid entry (future-dated entries are already skipped): `blocked` -> Blocked, `handed_off` -> Handed off, `started` -> In progress (last reported), `completed` -> Completed. Tasks whose latest entry has `Kind: retrospective` go to the separate, visually distinct "Recorded retrospective" column. Cards carry task ID, title, agent, status, kind, reported time and source file, blocker, next action, deliverable, evidence. Capped at 25 tasks per column (total shown) and 20 entries per agent. Banner: "Recorded status only — not live; Jarvis is read-only". Not browser-verified. Tests: `tests/isolation/kanban.test.mjs`.
## Usage panel (optional, off by default)
GET /api/usage adds exactly two more fixed allow-listed files, read only when needed: `.local/usage-panel.json` (opt-in flag; the summary is not read unless it says `{"enabled": true}`) and `.local/usage-summary.json` (written by the user-run `scripts/usage-summary.mjs`). Same safe reader (no symlinks/junctions/hardlinks, containment, 64 KB cap), strict whitelist validation, no client-supplied paths, no network. Disabled returns only `{"enabled":false}`. See `docs/integrations/jarvis-usage-panel.md`. Tests: `vendor\jarvis\tests\isolation\usage-summary.test.mjs`.

## Limitations
- The process is not sandboxed: it can read its app directory and the vault; the policy limits *content* reads to the vault, not process access.
- Browser rendering, the injected CSP and browser-side external requests were not verified (no browser was driven).
- The file-symlink and directory-symlink cases could not be run for lack of privilege (only a junction case ran); the swapped-file race test was skipped for the same reason.
- Vite HMR WebSocket upgrades bypass the connect middleware, so `vite.config.ts` adds an upgrade listener enforcing the Host/Origin allow-lists. Checked locally against Vite 5.4.21 (good Origin+Host+token+`vite-hmr` accepted; missing/wrong token 400; foreign Host or Origin 403). A WebSocket with no Origin header (non-browser client) is accepted by design if Host and token are valid. Other Vite versions are untested.
- Roster record reads reject files with nlink > 1 (hardlinks); content reads elsewhere do not. Roster text (names, roles, status fields) is display text any file author in the repo can spoof (inside the repo trust boundary). File symlinks for roster records are untested (no privilege).
- The check-then-use race (TOCTOU) is narrowed (open, re-verify, dev/ino compare) but not eliminated, and ino is weak on Windows.
- Search, tags and content-search serve only cached data built by the policy-checked worker.
- Warning: always set the project env vars before running vite, vitest or tsx; otherwise Jarvis reads the user's own config file.

## Dev-server artifact deny list, logs and Kanban caps

- The dev guard also returns 403 for non-source runtime artifacts, matched per path segment (case-insensitive, after repeated percent-decoding, backslash/NTFS ADS/trailing dot or space variants): `*.log *.err *.out *.tsbuildinfo *.pid *.bak *.orig *.swp *.tmp *.env *.pem *.key`, `optimization-log.json`, `MODIFICATIONS[.ext]`, `.env*`. Source, `/node_modules` deps, `index.html` and assets are unaffected.
- Launcher output is written to `.local\run\` (gitignored, outside the app dir), never under `vendor\jarvis`.
- Kanban field caps: title 160, evidence 600, deliverable/blocker/next action 300 characters; 64 KB per record and 25 tasks per column are unchanged.
