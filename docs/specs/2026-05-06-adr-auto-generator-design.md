# ADR Auto Generator (Decision Sniffer) — Design Spec

**Date:** 2026-05-06  
**Status:** approved  
**Scope:** v1 — code-change triggers only

---

## 1. Overview

A Claude Code plugin that passively monitors file edits for architectural decision signals and, when confidence is high, prompts the user once to capture the decision as a structured ADR (Architecture Decision Record) in Nygard format.

**Design principle:** hook = sensor, skill = actor. The hook layer detects and signals. The skill layer owns all user interaction, extraction, and file output.

---

## 2. Plugin Structure

```
adr-auto-generator/
├── package.json                        # name, version, plugin metadata
├── CLAUDE.md                           # directive: invoke adr-capture on signal
├── hooks/
│   ├── hooks.json                      # registers SessionStart, PostToolUse, UserPromptSubmit
│   ├── package.json                    # { "type": "commonjs" }
│   ├── adr-config.js                   # shared config loader (global + project merge)
│   ├── session-start.js                # clears ~/.claude/adr-session-hashes.json
│   ├── post-tool-use.js                # signal detector (v1 primary hook)
│   └── user-prompt-submit.js           # no-op placeholder (activates in v2)
└── skills/
    └── adr-capture/
        └── SKILL.md                    # owns full ADR flow
```

---

## 3. Hook Layer

### 3.1 hooks.json

Three registrations. All self-contained — no user configuration required for install.

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.js\"",
        "async": true
      }]
    }],
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [{ "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-use.js\"",
          "async": false }]
      },
      {
        "matcher": "Edit",
        "hooks": [{ "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-use.js\"",
          "async": false }]
      }
    ],
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/user-prompt-submit.js\"",
        "async": true
      }]
    }]
  }
}
```

`PostToolUse` is **synchronous** (`async: false`) so the signal blocks Claude before it responds.

### 3.2 session-start.js

Deletes `~/.claude/adr-session-hashes.json` on every new session. No user config needed.

### 3.3 post-tool-use.js — Signal Detector

**Input:** stdin JSON with `tool_name`, `tool_input` (`file_path`, `content`/`old_string`+`new_string`).

**Detection pipeline:**

```
1. tool_name ∈ {Write, Edit}?              → else exit 0, no output
2. isInfraFile(file_path, config)?         → else exit 0, no output
3. keyword = findDecisionKeyword(diff, config)?  → else exit 0, no output
4. hash = md5(file_path + "|" + keyword)
5. hash in ~/.claude/adr-session-hashes.json?  → exit 0, no output (deduped)
6. append hash to hashes file
7. emit signal JSON to stdout → Claude reads it
```

**Signal format (stdout):**
```json
{"signal":"adr-detected","file":"src/db/config.py","keyword":"migrate to","hash":"a3f19c"}
```

**Diff text extraction:**
- `Write` tool: use `content` field directly
- `Edit` tool: concatenate `old_string + " " + new_string` (covers both sides of change)

### 3.4 Default Infra File Patterns

Matched against `file_path` using glob/extension check. All configurable.

| Category | Patterns |
|----------|----------|
| JS/Node | `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` |
| Python | `requirements.txt`, `setup.py`, `pyproject.toml`, `Pipfile`, `Pipfile.lock` |
| JVM | `pom.xml`, `build.gradle`, `*.gradle`, `*.gradle.kts` |
| Container | `Dockerfile`, `*.dockerfile`, `docker-compose.yml`, `docker-compose.*.yml` |
| IaC | `*.tf`, `*.tfvars`, `*.hcl` |
| CI/CD | `.github/workflows/*.yml`, `.gitlab-ci.yml`, `Jenkinsfile`, `.circleci/config.yml` |
| DB/Migrations | `*migration*`, `*migrate*`, `*schema*`, `*seed*` |
| Config | `*.config.js`, `*.config.ts`, `*.config.mjs`, `config/**` |
| Build | `Makefile`, `*.mk`, `CMakeLists.txt` |

### 3.5 Default Decision Keywords

Matched as case-insensitive regex against diff text. All configurable.

```
migrate (from|to)
switch (from|to)
replace .+ with
moving? to
adopting?
deprecat(e|ing|ed)
use .+ instead (of)?
refactor .+ to
convert .+ to
port .+ to
new architecture
redesign
overhaul
drop .+ (in favor|for)
```

### 3.6 user-prompt-submit.js

**v1:** no-op. Reads stdin, exits 0, emits no output. Placeholder for v2 message scanning.

### 3.7 adr-config.js — Config Loader

Shallow merge: global defaults ← overridden by project config.

```javascript
// Load order:
// 1. ~/.claude/adr-config.json         (global defaults)
// 2. <process.cwd()>/.adr-config.json  (project overrides, optional)
// Merge: Object.assign({}, globalConfig, projectConfig)
```

**Config schema:**
```json
{
  "adrDir": "docs/adr",
  "infraPatterns": [...],
  "decisionKeywords": [...],
  "enableMessageScanning": false,
  "missedDecisionsLog": "~/.claude/adr-missed-decisions.log"
}
```

---

## 4. Skill Layer — adr-capture

### 4.1 Trigger

Invoked by Claude when CLAUDE.md directive fires on PostToolUse hook output containing `"signal":"adr-detected"`.

**CLAUDE.md directive:**
> If any PostToolUse hook output contains `"signal":"adr-detected"`, immediately invoke the `adr-capture` skill before responding. Do not skip this even if the decision seems minor.

### 4.2 Flow

```
1. Parse signal: file, keyword, hash
2. Idempotency check: read ~/.claude/adr-session-hashes.json
   → if hash already present: exit silently (defense-in-depth vs hook dedup)
3. Prompt user (inline):
   "Looks like you're making an architectural decision ([keyword] in [file]).
    Generate ADR? [yes / edit first / no]"
4a. "no" → exit silently
4b. "yes" or "edit first" →
    a. Extract context from recent conversation (~10 messages, keyword-proximity weighted)
       - Problem being solved
       - Options discussed
       - Rationale for choice
       - Trade-offs mentioned
    b. Auto-generate title: "[Verb] [subject]" derived from keyword + file
       e.g., "migrate to" + "db/config.py" → "Migrate Database ORM"
    c. Fill Nygard template (see §4.3)
    d. Attempt git SHA: `git rev-parse HEAD` at cwd
       → on failure or non-git-repo: omit Git reference line
    e. Present filled ADR inline in chat
    f. If "edit first": wait for user reply, apply corrections
       → if no reply after 2 prompts: save as-is with note "pending user review"
    g. Determine save path:
       - dir = config.adrDir (default: docs/adr, relative to cwd)
       - n = count of *.md files in dir + 1, zero-padded to 4 digits (e.g., 0004)
       - slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
       - filename = YYYY-MM-DD-<slug>.md (date = today)
       - full path = <cwd>/<adrDir>/<filename>
       - update ADR title line to "# ADR-<n>: <Title>"
    h. Create dir if not exists
    i. Write ADR file
    j. Confirm: "ADR saved to docs/adr/2026-05-06-migrate-database-orm.md"
```

### 4.3 Nygard Template

```markdown
# ADR-NNNN: <Title>

**Date:** YYYY-MM-DD  
**Status:** proposed  
**Git reference:** <SHA> (omit if no git repo)

## Context

<What situation or problem prompted this decision? 2-4 sentences.>

## Decision

<What was decided, stated as an active-voice sentence. 1-3 sentences.>

## Alternatives Considered

- **<Alternative 1>:** <Why not chosen, 1 sentence>
- **<Alternative 2>:** <Why not chosen, 1 sentence>
- *(Add more as needed)*

## Consequences

**Positive:**
- <Benefit 1>
- <Benefit 2>

**Negative / Trade-offs:**
- <Trade-off 1>
- <Trade-off 2>
```

Target length: 200–400 words. Not a full design doc — capture the decision, not re-explain the domain.

### 4.4 Context Extraction Heuristic

From recent conversation history (up to last 10 messages):
1. Messages within 3 turns of the triggering file edit get full weight
2. Messages containing the decision keyword get full weight
3. Remaining messages get partial weight (used to fill gaps only)
4. If context is ambiguous, ask user one clarifying question before filling template

### 4.5 Edge Cases

| Scenario | Handling |
|----------|----------|
| No git repo | Omit "Git reference" line entirely |
| `docs/adr/` doesn't exist | Create directory tree before writing |
| "Edit first" — no user reply after 2 prompts | Save as-is, append "**Status:** pending user review" |
| File already exists at target path | Append `-2`, `-3`, etc. to slug |
| Very long conversation history | Use keyword-proximity weighting (§4.4) |
| Ambiguous context | Ask one clarifying question before filling template |
| Signal hash already in session hashes | Skip silently (idempotency) |

---

## 5. State Files

| File | Scope | Content | Cleared |
|------|-------|---------|---------|
| `~/.claude/adr-session-hashes.json` | session | `{"<hash>": "<ISO timestamp>"}` | SessionStart hook |
| `~/.claude/adr-config.json` | global | config defaults | never (user-managed) |
| `.adr-config.json` | project | config overrides | never (user-managed) |
| `~/.claude/adr-missed-decisions.log` | persistent | keyword matches without file trigger | never (v2 review tool) |

---

## 6. Filename / Slug Convention

```
Input title:  "Migrate from SQLAlchemy to Peewee"
Slug:         migrate-from-sqlalchemy-to-peewee
Filename:     2026-05-06-migrate-from-sqlalchemy-to-peewee.md
Full path:    docs/adr/2026-05-06-migrate-from-sqlalchemy-to-peewee.md
```

Rules:
1. Lowercase entire title
2. Replace any sequence of non-alphanumeric characters with a single hyphen
3. Strip leading/trailing hyphens
4. Prepend `YYYY-MM-DD-` (today's date at save time)
5. Append `.md`

---

## 7. v2 Backlog (out of scope for v1)

- **Message scanning:** activate `user-prompt-submit.js` to detect keywords in user messages (no file change required). Toggle via `enableMessageScanning: true` in config.
- **Weighted confidence scoring:** infra file = +2, keyword in diff = +1, prompt at configurable threshold.
- **Cross-session dedup:** persist hashes beyond session boundary to avoid re-prompting on reopened sessions.
- **Batch detection:** if two signals fire within same logical change (e.g., same PR), merge into single prompt.
- **ADR index:** auto-maintain `docs/adr/README.md` index linking all ADRs.
- **Status transitions:** commands to update ADR status (proposed → accepted → superseded).

---

## 8. Install & Configuration

### Install
```bash
# From plugin marketplace (once published)
claude plugin install adr-auto-generator

# Or manually: clone repo, copy to ~/.claude/plugins/local/adr-auto-generator/
```

### Global config: `~/.claude/adr-config.json`
```json
{
  "adrDir": "docs/adr",
  "infraPatterns": ["package.json", "docker-compose.yml", "*.tf", "..."],
  "decisionKeywords": ["migrate to", "switch from", "replace .+ with", "..."],
  "enableMessageScanning": false
}
```

### Per-project config: `.adr-config.json` (at repo root)
```json
{
  "adrDir": "architecture/decisions",
  "decisionKeywords": ["migrate to", "adopt", "deprecate", "custom-signal"]
}
```

Merge is shallow: any key present in project config overrides the global value entirely (arrays are not merged, they are replaced).

---

## 9. Example Session

```
[User and Claude discussing moving from REST to GraphQL]
[Claude edits package.json — adds graphql dependency, removes axios]
[Diff contains "replace axios with graphql-request"]

→ PostToolUse hook fires
→ isInfraFile("package.json") = true
→ findDecisionKeyword("replace axios with graphql-request") = "replace .+ with"
→ hash("package.json|replace .+ with") = "b7e3a1"
→ not in session hashes → emit signal

Claude: "Looks like you're making an architectural decision (replace .+ with in package.json).
         Generate ADR? [yes / edit first / no]"

User: "yes"

Claude: [extracts context — GraphQL migration discussion from last 8 messages]
        [generates title: "Replace REST Client with GraphQL"]
        [fills Nygard template]
        [runs git rev-parse HEAD → abc1234]

---
# ADR-0001: Replace REST Client with GraphQL

**Date:** 2026-05-06
**Status:** proposed
**Git reference:** abc1234

## Context
The current REST API client (axios) requires multiple round-trips for
dashboard queries, causing performance issues under load. The team
evaluated GraphQL as a way to consolidate data fetching.

## Decision
Replace axios-based REST calls with graphql-request against a new
GraphQL endpoint, starting with the dashboard module.

## Alternatives Considered
- **Keep REST, add request batching:** Reduces round-trips but requires
  custom batching logic and doesn't solve over-fetching.
- **Switch to tRPC:** Type-safe but requires full-stack refactor out of scope.

## Consequences
**Positive:**
- Single query replaces 4 REST calls on dashboard load
- Frontend controls data shape, reduces over-fetching

**Negative / Trade-offs:**
- Team needs GraphQL training
- REST endpoints must be maintained in parallel during migration
---

ADR saved to docs/adr/2026-05-06-replace-rest-client-with-graphql.md
```
