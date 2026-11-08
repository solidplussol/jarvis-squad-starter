# Specialist status records

One record per squad member: `docs/status/<id>.md`, where `<id>` is the member's id: the lowercase slug of their name in the `## Members` table of `.squad/team.md` (spaces become hyphens; letters, digits and hyphens only, max 40 characters; e.g. `Fact Checker` -> `fact-checker`). Agents must use exactly that id for the file name and the `Agent` field. The Jarvis Agents panel reads one such file per roster member (up to 20, read-only, via `GET /api/agents`) and shows them as **"Last reported"**; files for names not in the roster are never read. A record is a saved report of past activity. It is never evidence that an agent is running now. A member with no file shows as Configured with no updates. The roster is dynamic: it comes from `.squad/team.md` (cross-checked with `.squad/casting/registry.json`); Jarvis opens only 3 fixed files plus each member's charter and `docs/status/<id>.md` (max 20 members, 43 files). Ids must match `^[a-z0-9][a-z0-9-]{0,39}$`; `readme` is reserved and names containing `_` or other characters are rejected. Built-in agents (scribe, ralph, rai, fact-checker) show only if listed in the Members table. An empty or unparseable roster shows no agents plus a reason. Squads must follow this file for status to appear; a file whose `Agent` field does not match its member is ignored and the card shows Unknown.

## Rules
- Each agent writes ONLY its own file, appending one entry at task start, handoff, blockage and completion. Never edit or delete earlier entries.
- No secrets, prompts, raw histories or business data. `Deliverable` and `Evidence` are project-relative paths or short plain text.
- Jarvis never writes these files.
- Every entry starts with the line `## Update` and is followed by `Key: value` lines, one per line. Anything else (headings, prose) is ignored by the reader.
- Field values are plain text, at most 200 characters; markup is stripped. Use `none` for an empty optional field.
- The reader shows the latest 20 entries per agent; a malformed entry is skipped (and counted), never fatal. An entry is malformed if a required field is missing or invalid, or if `Agent` does not match the file.

## Fields
| Field | Required | Value |
|---|---|---|
| `Agent` | yes | the file's member id (must equal the `<id>` in the file name) |
| `Task ID` | yes | letters, digits, `.`, `_`, `-`; max 64 characters |
| `Task title` | yes | short text |
| `Status` | yes | `started` \| `handed_off` \| `blocked` \| `completed` |
| `Reported` | yes | ISO-8601 with offset, e.g. `2026-11-07T17:00:00-05:00`; `unknown` is allowed ONLY for `retrospective` entries. Never invent a timestamp. |
| `Blocker` | no | text or `none` |
| `Next action` | no | text or `none` |
| `Deliverable` | no | project-relative path or short text |
| `Evidence` | no | project-relative path or short text |
| `Kind` | yes | `live_report` (written when it happened) \| `retrospective` |

A `retrospective` entry reconstructs earlier work from existing evidence. Its `Task title` must start with `Retrospective summary:` and the UI labels it "Retrospective summary".

## Ordering and state
Latest entry = newest `Reported` time. A `Reported` time more than 5 minutes in the future is treated as invalid: the entry is skipped (counted in `skippedEntries`) and can never become "latest". Entries with `unknown` time rank after timed ones and are ordered by file position (later = newer). The panel shows the `Reported` time (from the record) and the file's modified time separately; they can differ.
State: `last_reported` = at least one valid entry; `configured` = no entries; `unknown` = unreadable file or only malformed entries. `running` is never shown.

## Example
```markdown
# Status record: integration

## Update
Agent: integration
Task ID: INT-001
Task title: Example task (synthetic)
Status: started
Reported: 2026-11-07T17:00:00-05:00
Blocker: none
Next action: Draft the adapter contract
Deliverable: docs/integrations/example.md
Evidence: none
Kind: live_report
```

## Kanban derivation
The read-only Jarvis Kanban is rebuilt from these records only. Task identity = agent + Task ID; the latest valid entry decides the column: started -> In progress (last reported), handed_off -> Handed off, blocked -> Blocked, completed -> Completed. Entries with Kind: retrospective appear in a separate Recorded retrospective column. To move a card, append a new ## Update entry with the same Task ID; Jarvis never writes.
