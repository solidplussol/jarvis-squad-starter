---
name: "launch-jarvis"
description: "Launch, verify and stop this repo's read-only Jarvis dashboard. Use when the user says 'launch Jarvis', 'start Jarvis', 'open Jarvis' or 'stop Jarvis'."
domain: "tooling"
confidence: "high"
source: "user-request"
---

## Launch

1. Run from the repo root: `powershell -File scripts\start-jarvis.ps1`
   - If `vendor\jarvis\node_modules` is missing, first run `cd vendor\jarvis; npm ci --ignore-scripts`.
   - The script picks the first free API/UI port pair (3102/5273, then +10 each) and prints the URLs and PIDs. Other Jarvis copies (e.g. other projects) may hold the defaults; never stop them.
2. Verify with the ports the script printed (do not assume the defaults):
   - UI returns HTTP 200.
   - `GET http://127.0.0.1:{apiPort}/api/agents` has `rosterSource` = `.squad/team.md` and lists this repo's members.
   - If the roster is not this repo's, the ports belong to another Jarvis: read `.local\run\api.err.log` and `ui.err.log`.
3. Tell the user the UI URL, API URL and stop command.

## Stop

`Stop-Process -Id <apiPid>,<uiPid>` using the PIDs printed by the script (also in `.local\run\pids.txt`). Never stop processes by name.

## Rules

- Never run `vite`, `vitest` or `tsx` without `JARVIS_PROJECT_MODE=1` and `JARVIS_PROJECT_VAULT` set, or Jarvis reads `~\.jarvis-config.yaml`.
- Jarvis is read-only and shows recorded status only, not live agent activity.
- Details: `docs\integrations\jarvis-project-isolation.md`.
