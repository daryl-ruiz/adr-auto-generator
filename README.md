# ADR Auto Generator

A [Claude Code](https://docs.claude.com/en/docs/claude-code) plugin that watches
your edits for architectural decisions and helps you capture them as
[Nygard-style ADRs](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
— without breaking your flow.

> You change a dependency, swap a database driver, or migrate a config file.
> The plugin notices, asks once if you want an ADR, and writes the file with
> the surrounding conversation as context.

## Why

Most teams know they *should* write ADRs. Almost none do. Friction kills it:
remembering to do it, finding the right template, summarising the context,
choosing a number, picking a filename. This plugin removes every step except
the one a human has to do — saying "yes."

## How it looks

While Claude is editing files for you:

```
Looks like you're making an architectural decision:
migrate from in package.json. Want me to capture it as an ADR?

Reply with yes, edit first, or no.
```

You reply `yes`. Claude reads the recent conversation, fills the Nygard
template, and saves:

```
docs/adr/2026-05-07-migrate-from-axios-to-native-fetch.md
```

That's it.

---

## Requirements

- **Claude Code** ≥ 2.1.0 (uses `hookSpecificOutput.additionalContext` injection)
- **Node.js** ≥ 18 (the hooks run via Node's stdlib only — no `npm install` step)
- **git** (optional — used to record the commit SHA in each ADR)

No runtime dependencies.

---

## Install

Three install paths. Pick whichever fits your setup.

### A. Local marketplace (recommended for dev / private use)

```bash
git clone https://github.com/daryl-ruiz/adr-auto-generator
```

Add the local marketplace + enable the plugin in `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "adr-auto-generator-local": {
      "source": {
        "source": "directory",
        "path": "/absolute/path/to/adr-auto-generator"
      }
    }
  },
  "enabledPlugins": {
    "adr-auto-generator@adr-auto-generator-local": true
  }
}
```

Then in Claude Code:

```
/plugin install adr-auto-generator@adr-auto-generator-local
```

Restart Claude Code.

### B. GitHub marketplace

```
/plugin marketplace add daryl-ruiz/adr-auto-generator
/plugin install adr-auto-generator@adr-auto-generator
```

### C. `--plugin-dir` (one-shot, no settings.json)

```bash
git clone https://github.com/daryl-ruiz/adr-auto-generator
claude --plugin-dir ./adr-auto-generator
```

Useful for trying the plugin in a single Claude Code session without
touching global settings.

### Verify install

In Claude Code, run:

```
/plugin
```

You should see `adr-auto-generator` listed and enabled. Then make a small
edit to `package.json` containing the phrase `migrate from X to Y` — the
plugin should prompt you to capture an ADR.

---

## Configuration

Both files are optional. The plugin works out of the box.

### Per-project — `.adr-config.json` (repo root)

```json
{
  "adrDir": "docs/adr",
  "decisionKeywords": ["migrate (from|to)", "adopt", "deprecate"],
  "enableMessageScanning": true
}
```

### Global — `~/.claude/adr-config.json`

Same shape. Project file overrides global; global overrides defaults.

> **Note:** any key you set **replaces** (not merges) the default array.
> If you only want to add a keyword, copy the full default list and append.

### Defaults

```json
{
  "adrDir": "docs/adr",

  "infraPatterns": [
    "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "requirements.txt", "setup.py", "pyproject.toml", "Pipfile", "Pipfile.lock",
    "pom.xml", "build.gradle",
    "Dockerfile", "docker-compose.yml",
    "*.tf", "*.tfvars", "*.hcl",
    "Makefile",
    "*.config.js", "*.config.ts", "*.config.mjs",
    "app.py", "main.py", "index.ts", "server.js"
  ],

  "infraPathPrefixes": [
    ".github/workflows/", ".gitlab-ci.yml",
    "config/", "infra/", "deploy/"
  ],

  "infraNamePatterns": ["migration", "migrate", "schema", "seed"],

  "infraContentPatterns": [
    "import\\s+asyncpg",
    "from\\s+sqlalchemy\\s+import",
    "import\\s+sqlalchemy",
    "import\\s+redis",
    "import\\s+celery",
    "from\\s+pydantic\\s+import"
  ],

  "decisionKeywords": [
    "migrate (from|to)",
    "switch (from|to)",
    "replace .+ with",
    "moving? to",
    "adopt(ing)?",
    "deprecat(e|ing|ed)",
    "use .+ instead( of)?",
    "refactor .+ to",
    "convert .+ to",
    "port .+ to",
    "new architecture",
    "redesign",
    "overhaul",
    "drop .+ (in favor|for)"
  ],

  "enableMessageScanning": true
}
```

### Tuning sensitivity

| Symptom | Fix |
|---------|-----|
| Plugin prompts on routine version bumps | Tighten `decisionKeywords` (remove broad ones like `adopt`) |
| Plugin misses real decisions in source files | Add an entry to `infraContentPatterns` (e.g. `"import\\s+yourLib"`) |
| Wrong filename triggers detection | Override `infraNamePatterns` with a smaller list |
| Want ADRs in a different directory | Set `adrDir` (e.g. `"architecture/decisions"`) |

A file must match the *infra* test **AND** contain a *decision keyword* for
the plugin to fire. Both conditions reduce false positives.

---

## How it works

```
                              tool runs
   user: change axios → fetch ────────────►  Claude edits package.json
                                                       │
                                                       ▼
                            ┌──────────────────────────────────────────┐
                            │  PostToolUse hook (post-tool-use.js)     │
                            │  - is file in adrDir?  → ignore           │
                            │  - is it infra?  + has keyword?           │
                            │  - already emitted this session?  → skip  │
                            │  - else: record + emit signal             │
                            └─────────────────┬────────────────────────┘
                                              │  hookSpecificOutput
                                              ▼
                            ┌──────────────────────────────────────────┐
                            │  CLAUDE.md directive: invoke adr-capture  │
                            └─────────────────┬────────────────────────┘
                                              ▼
                            ┌──────────────────────────────────────────┐
                            │  adr-capture skill                        │
                            │  - already-captured hash?  → exit         │
                            │  - prompt user (yes / edit first / no)    │
                            │  - extract context, fill Nygard template  │
                            │  - save docs/adr/YYYY-MM-DD-<slug>.md     │
                            │  - record hash to captured store          │
                            └──────────────────────────────────────────┘
```

### State files (`~/.claude/`)

| File | Owner | Lifetime | Purpose |
|------|-------|----------|---------|
| `adr-emitted-hashes.json` | hook | session | Prevents duplicate signals for the same edit |
| `adr-captured-hashes.json` | skill | persistent | Prevents re-prompting for ADRs you already accepted |
| `adr-pending-intents.json` | hook | session | Recent decision-language excerpts from your prompts (correlates "we should migrate" with the actual edit) |

Single writer per file — no race. Captured hashes persist across sessions
on purpose: once you've said yes to an ADR, the plugin doesn't ask again.

> **Migrating from < v0.2?** The legacy `adr-session-hashes.json` is
> automatically renamed to `adr-emitted-hashes.json` on first run.
> No action needed.

---

## Troubleshooting

**Plugin doesn't prompt after an edit.**
Check that the file is in `infraPatterns`/`infraPathPrefixes` *and* the diff
contains a `decisionKeywords` regex match. Both required. To debug, run the
hook directly:

```bash
echo '{"tool_name":"Edit","tool_input":{"file_path":"package.json","old_string":"x","new_string":"replace x with y"}}' \
  | node ~/.claude/plugins/cache/adr-auto-generator-local/adr-auto-generator/0.1.0/hooks/post-tool-use.js
```

If it prints a `hookSpecificOutput` JSON object, detection is working —
the issue is on the Claude Code side (check `/plugin` shows the plugin
enabled).

**Plugin prompted, but Claude didn't run the skill.**
Make sure your Claude Code is ≥ 2.1.0. Older versions don't inject
`hookSpecificOutput.additionalContext` into the model context, so the
CLAUDE.md directive never receives the signal.

**Same decision keeps re-prompting in new sessions.**
Expected if you say "no" each time — the plugin only records *captured*
ADRs in the persistent store. Either say "yes" once, or add the hash to
`~/.claude/adr-captured-hashes.json` manually.

**Want to reset all state.**
```bash
rm -f ~/.claude/adr-emitted-hashes.json \
      ~/.claude/adr-captured-hashes.json \
      ~/.claude/adr-pending-intents.json
```

---

## Uninstall

```
/plugin uninstall adr-auto-generator@adr-auto-generator-local
```

Remove the marketplace entry from `~/.claude/settings.json` (`extraKnownMarketplaces`)
if you no longer need it. State files in `~/.claude/adr-*` can be deleted manually.

---

## Contributing

```bash
git clone https://github.com/daryl-ruiz/adr-auto-generator
cd adr-auto-generator
node --test tests/*.test.js
```

The hooks are zero-dependency Node — `node --test` is the entire CI surface.
PRs welcome for new keyword/file patterns, language-specific
`infraContentPatterns`, or templates beyond Nygard.

### Project layout

```
hooks/                  Node scripts wired to Claude Code hook events
  post-tool-use.js      detection on Write/Edit
  session-start.js      clears session-scoped state
  user-prompt-submit.js records decision-language intents from prompts
  detector.js           shared detection logic
  adr-config.js         config loader (defaults + global + project)
  intents.js            pending-intents store

skills/adr-capture/
  SKILL.md              the human-in-the-loop ADR capture flow

CLAUDE.md               directive that wires hook signal → skill invocation
.claude-plugin/
  plugin.json           Claude Code plugin manifest
  marketplace.json      local marketplace manifest (for dev)
tests/                  node:test suite (zero deps)
```

---

## Example output

```markdown
# ADR-0001: Migrate from Axios to Native Fetch

**Date:** 2026-05-07
**Status:** proposed
**Git reference:** a1b2c3d4

## Context

The project used axios for server-side HTTP. Node 18+ ships fetch built-in,
making a third-party HTTP client unnecessary for simple request/response
patterns. Reducing external dependencies lowers attack surface and install weight.

## Decision

Remove axios from package.json. Replace axios.get() calls in server.js with
native fetch; parse responses via response.json() instead of response.data.

## Alternatives Considered

- **Keep axios:** Familiar API and rich interceptor support, but adds a
  dependency for what is now a stdlib feature.
- **node-fetch:** Same API as native fetch but still a dependency, defeating
  the purpose.

## Consequences

**Positive:**
- One fewer runtime dependency — smaller node_modules, faster installs
- No third-party HTTP client to patch for CVEs

**Negative / Trade-offs:**
- No interceptors or automatic JSON serialisation for request bodies
- Requires Node 18+; older runtimes need a polyfill
```

---

## Roadmap

- [x] hookSpecificOutput injection contract
- [x] Dual-store dedup (emitted vs captured)
- [x] adrDir self-trigger exclusion
- [x] Cross-session capture dedup
- [ ] Weighted confidence scoring (only prompt above threshold)
- [ ] ADR index auto-maintenance (`docs/adr/README.md`)
- [ ] Status transitions (proposed → accepted → superseded)
- [ ] Other templates (MADR, Y-statement)

## License

MIT
