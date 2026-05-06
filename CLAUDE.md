# ADR Auto Generator

This plugin monitors file edits for architectural decision signals and captures them as ADR documents.

## Available Skills

- **adr-capture** (`skills/adr-capture/SKILL.md`): Guides the full ADR creation flow — prompts the user, extracts context, fills the Nygard template, and saves the file.

## PostToolUse Hook Directive

**This is a hard rule.** If any PostToolUse hook output contains the key `"signal":"adr-detected"`, you MUST invoke the `adr-capture` skill immediately — before composing your response to the user. Do not skip this step even if the decision seems minor or if you are in the middle of another task.

The signal has this shape:
```json
{"signal":"adr-detected","file":"path/to/file","keyword":"matched keyword","hash":"8charHex"}
```

Pass the `file`, `keyword`, and `hash` values to the skill as context when invoking it.

## What NOT to Do

- Do not summarize or paraphrase the signal to the user — invoke the skill instead.
- Do not skip the skill because you "already know" what the decision is.
- Do not invoke the skill more than once per signal (the hash dedup in the skill handles repeated signals).
