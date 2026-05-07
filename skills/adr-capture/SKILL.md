# adr-capture — Architectural Decision Record Capture

Invoked by CLAUDE.md directive when PostToolUse hook emits `{"signal":"adr-detected",...}`.

## Inputs

From the signal injected by the hook:
- `file` — the file path that triggered detection
- `keyword` — the matched decision keyword string
- `hash` — 8-character hex dedup key

## Step 1: Idempotency Check

Use the Read tool to read `~/.claude/adr-captured-hashes.json`. This file
records hashes of ADRs already saved by this skill (written in Step 12 below).
It is owned exclusively by the skill — the hook never touches it.

- If the file does not exist: continue to Step 2.
- If `hash` is a key in that file: **exit silently.** Do not prompt the user.

> Why this file (and not `adr-emitted-hashes.json`)? The hook records every
> emitted signal hash to `adr-emitted-hashes.json` to prevent duplicate
> *signals*; that file is always populated for any signal you receive, so
> checking it here would always exit silently. The skill needs a separate
> store that only fills after a successful save, so the idempotency check
> distinguishes "already captured" from "first time seeing this signal."

## Step 2: Prompt the User

Present exactly this message (substitute `[keyword]` and `[file]`):

> Looks like you're making an architectural decision: **[keyword]** in `[file]`.
> Want me to capture it as an ADR?
>
> Reply with **yes**, **edit first**, or **no**.

Wait for the user's reply. If the reply is unclear, ask them to choose one of the three options.

## Step 3: Handle "no"

Exit silently. Do not generate anything.

## Step 4: Extract Context ("yes" or "edit first")

Scan the last 10 messages in the conversation. Weight messages as follows:
1. Messages within 3 turns of the file edit → full weight (prioritize these)
2. Messages containing `keyword` → full weight
3. All other messages → partial weight (fill gaps only)

From this context, extract:
- **Problem / context:** What situation or constraint prompted this change?
- **Decision:** What specifically was decided?
- **Alternatives:** What other options were discussed or implied?
- **Consequences:** What trade-offs or expected outcomes were mentioned?

If you cannot determine what was decided or why (context is ambiguous), ask ONE clarifying question before continuing.

## Step 5: Determine ADR Number

Run via Bash tool:
```bash
ls <adrDir>/*.md 2>/dev/null | wc -l
```
Where `<adrDir>` is the resolved ADR directory (see Config Reading below).

ADR number = (count of .md files) + 1, zero-padded to 4 digits.
Examples: 0 existing files → `ADR-0001`. 3 existing files → `ADR-0004`.

## Step 6: Generate Title

Derive a short, active-voice title from the keyword and file context. Examples:
- keyword `replace axios with`, file `package.json` → `Replace REST Client with GraphQL`
- keyword `migrate to`, file `requirements.txt` → `Migrate Python Package Manager`
- keyword `switch from`, file `docker-compose.yml` → `Switch Container Orchestration`
- keyword `deprecating`, file `api/v1/routes.py` → `Deprecate API v1 Routes`

If no clear title can be derived: use `[Capitalized Keyword] in [basename without extension]`.

## Step 7: Get Git SHA

Run via Bash tool:
```bash
git rev-parse HEAD 2>/dev/null
```
If the command fails or output is empty: set `gitRef = null`.

## Step 8: Fill Nygard Template

Populate the template below. Omit the `**Git reference:**` line entirely if `gitRef` is null.
Keep total length 200–400 words.

```markdown
# ADR-[N]: [Title]

**Date:** [YYYY-MM-DD]
**Status:** proposed
**Git reference:** [SHA]

## Context

[2-4 sentences: the situation, problem, or constraint that prompted this decision]

## Decision

[1-3 sentences: what was decided, stated in active voice]

## Alternatives Considered

- **[Alternative 1]:** [Why not chosen, 1 sentence]
- **[Alternative 2]:** [Why not chosen, 1 sentence]

## Consequences

**Positive:**
- [Benefit]

**Negative / Trade-offs:**
- [Trade-off]
```

If no alternatives were discussed in context: write a single bullet: `- No alternatives were discussed.`

## Step 9: Present Draft

Show the filled template inline in the conversation inside a fenced markdown code block.

## Step 10: Handle "edit first" — Wait for Edits

If the user chose **edit first**:
- After presenting the draft, say: `"Reply with your edits and I'll apply them before saving."`
- Wait for the user's reply. Apply their corrections to the template.
- If no edits reply after **2 follow-up prompts**: save the draft as-is and set `**Status:** pending user review`.

If the user chose **yes**: proceed directly to Step 11.

## Step 11: Determine Save Path

Read config in this order (stop at first match):
1. Read `<cwd>/.adr-config.json` — use `adrDir` if present
2. Read `~/.claude/adr-config.json` — use `adrDir` if present
3. Default: `docs/adr`

Build the file path:
```
slug     = title.toLowerCase()
           → replace sequences of non-alphanumeric chars with hyphens
           → strip leading and trailing hyphens
filename = YYYY-MM-DD-<slug>.md   (today's date at save time)
fullPath = <cwd>/<adrDir>/<filename>
```

If `fullPath` already exists: append `-2`, `-3`, etc. to slug until the path is unique.

## Step 12: Create Directory and Save

Run via Bash tool:
```bash
mkdir -p <adrDir>
```

Write the final ADR using the Write tool to `<fullPath>`.

## Step 12.5: Record Captured Hash

After the Write tool succeeds, append the current `hash` to
`~/.claude/adr-captured-hashes.json` so future invocations of this skill
exit silently in Step 1.

Procedure:
1. Read `~/.claude/adr-captured-hashes.json`. If it does not exist or
   parsing fails, treat it as `{}`.
2. Add the entry:
   ```json
   "<hash>": { "capturedAt": "<ISO8601 now>", "path": "<fullPath>" }
   ```
3. Write the updated object back to `~/.claude/adr-captured-hashes.json`
   with `JSON.stringify(data, null, 2)` formatting (use the Write tool).

This file is owned exclusively by the skill. The hook does not read or
write it — its `adr-emitted-hashes.json` lives separately so the two
dedup concerns never collide.

## Step 13: Confirm

Reply to the user:
> `ADR saved to <fullPath>`

---

## Config Reading Reference

To resolve `adrDir`, use the Read tool on `.adr-config.json` (project) and `~/.claude/adr-config.json` (global) in that order. Take the first `adrDir` value found. Default `docs/adr`.

## Edge Case Reference

| Scenario | Handling |
|----------|----------|
| No git repo (`git rev-parse` fails) | Omit `**Git reference:**` line entirely |
| `adrDir` does not exist | `mkdir -p` before writing |
| File already exists at target path | Append `-2`, `-3` to slug |
| Context is ambiguous | Ask one clarifying question, then continue |
| "edit first" — no reply after 2 prompts | Save with `**Status:** pending user review` |
| Hash already in `adr-captured-hashes.json` | Exit silently (Step 1) |
| Write to `adr-captured-hashes.json` fails | Log nothing; ADR is saved either way. The next invocation may re-prompt — preferable to losing the ADR. |
| Alternatives not discussed | Single bullet: `- No alternatives were discussed.` |

---

## Example Session

**Signal received:** `{"signal":"adr-detected","file":"package.json","keyword":"replace axios with","hash":"b7e3a1"}`

**Skill prompts:**
> Looks like you're making an architectural decision: **replace axios with** in `package.json`.
> Want me to capture it as an ADR?
>
> Reply with **yes**, **edit first**, or **no**.

**User replies:** `yes`

**Skill generates and saves:**

```markdown
# ADR-0001: Replace REST Client with GraphQL

**Date:** 2026-05-06
**Status:** proposed
**Git reference:** abc1234def56789

## Context

The dashboard page required four separate REST API calls on each load,
causing visible latency under moderate traffic. The team evaluated
consolidating data fetching to reduce round-trips and eliminate
over-fetching of unused fields.

## Decision

Replace axios-based REST calls with graphql-request targeting the new
GraphQL endpoint. Migration begins with the dashboard module and extends
to other views incrementally.

## Alternatives Considered

- **Keep REST with request batching:** Reduces round-trips but requires
  custom batching logic and does not solve over-fetching.
- **Switch to tRPC:** Provides end-to-end type safety but requires a
  full-stack refactor outside the current sprint scope.

## Consequences

**Positive:**
- Dashboard load reduces from 4 REST requests to 1 GraphQL query
- Frontend controls response shape, eliminating over-fetching

**Negative / Trade-offs:**
- Team requires GraphQL training before migration can proceed
- REST endpoints must remain active during the transition period
```

ADR saved to `docs/adr/2026-05-06-replace-rest-client-with-graphql.md`
