# ADR Auto Generator (Decision Sniffer)

A Claude Code plugin that detects architectural decisions from file edits and
guides you through capturing them as [Nygard-style ADRs](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

## What it does

Whenever Claude edits an infrastructure or configuration file (e.g., `package.json`,
`Dockerfile`, `*.tf`) and the diff contains a decision keyword (e.g., "migrate to",
"replace X with"), the plugin:

1. Checks it hasn't already prompted for this decision (session-scoped dedup)
2. Asks: "Looks like you're making an architectural decision. Generate ADR? yes / edit first / no"
3. Extracts context from the recent conversation
4. Pre-fills a Nygard template and saves to `docs/adr/YYYY-MM-DD-<title>.md`
5. Records the current git commit SHA in the ADR

## Installation

### Option 1 — Marketplace

```
/plugin marketplace add adr-auto-generator
/plugin install adr-auto-generator
```

### Option 2 — settings.json

Add to `~/.claude/settings.json`:

```json
{
  "plugins": ["adr-auto-generator"]
}
```

Restart Claude Code to activate.

### Option 3 — --plugin-dir (local / dev)

```bash
git clone https://github.com/daryl-ruiz/adr-auto-generator
claude --plugin-dir ./adr-auto-generator
```

Or point to any local clone:

```bash
claude --plugin-dir /path/to/adr-auto-generator
```

## Configuration

### Global defaults — `~/.claude/adr-config.json`

```json
{
  "adrDir": "docs/adr",
  "infraPatterns": ["package.json", "docker-compose.yml", "*.tf", "Makefile"],
  "infraPathPrefixes": [".github/workflows/", "config/", "infra/"],
  "infraNamePatterns": ["migration", "schema", "seed"],
  "decisionKeywords": [
    "migrate (from|to)",
    "replace .+ with",
    "switch (from|to)",
    "deprecat(e|ing|ed)"
  ],
  "enableMessageScanning": false
}
```

### Per-project override — `.adr-config.json` (at repo root)

Any key here **replaces** (not merges) the global value.

```json
{
  "adrDir": "architecture/decisions",
  "decisionKeywords": ["migrate to", "adopt", "deprecate", "custom-signal"]
}
```

### Sensitivity tuning

| Too many false positives | Too few detections |
|--------------------------|-------------------|
| Remove patterns from `infraPatterns` | Add patterns to `infraPatterns` |
| Remove keywords from `decisionKeywords` | Add keywords to `decisionKeywords` |
| Confidence requires both infra file AND keyword (by design) | Check `adr-missed-decisions.log` (v2 feature) |

## ADR directory

Default: `docs/adr/` relative to your project root.
Override per-project: `.adr-config.json` → `"adrDir": "your/path"`.

## Extending signal patterns

Edit `~/.claude/adr-config.json`:
- `infraPatterns`: exact filenames or `*.ext` globs
- `infraPathPrefixes`: path substrings (e.g., `"migrations/"`)
- `infraNamePatterns`: filename substrings matched case-insensitively
- `decisionKeywords`: case-insensitive regex strings

## Running tests

```bash
node --test tests/*.test.js
```

## Example output

Claude edits `requirements.txt`, diff contains "migrate to peewee":

```
Looks like you're making an architectural decision: migrate to in requirements.txt.
Want me to capture it as an ADR?

Reply with yes, edit first, or no.
```

User replies `yes` → Claude generates and saves:

```
docs/adr/2026-05-06-migrate-python-orm.md
```

Contents:

```markdown
# ADR-0001: Migrate Python ORM

**Date:** 2026-05-06
**Status:** proposed
**Git reference:** a1b2c3d4e5f6

## Context
The project used SQLAlchemy for all database access. Performance
profiling showed N+1 query issues that were difficult to address
within SQLAlchemy's ORM model.

## Decision
Migrate database access layer from SQLAlchemy to Peewee, starting
with the user and session models.

## Alternatives Considered
- **Keep SQLAlchemy, add eager loading:** Reduces N+1 but requires
  extensive query auditing across the codebase.
- **Raw SQL with psycopg2:** Maximum performance but loses ORM
  benefits entirely.

## Consequences
**Positive:**
- Simpler query model reduces N+1 issues by default
- Smaller dependency footprint

**Negative / Trade-offs:**
- Migration requires updating all model definitions
- Team unfamiliar with Peewee API
```

## v2 Roadmap

- Message scanning (detect decisions without file changes, via `enableMessageScanning`)
- Weighted confidence scoring
- Cross-session dedup
- ADR index (`docs/adr/README.md` auto-maintained)
- Status transitions (proposed → accepted → superseded)
