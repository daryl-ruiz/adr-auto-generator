#!/usr/bin/env node
// hooks/session-start.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const claudeDir =
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

// Session-scoped state: cleared at the start of every Claude Code session
// so the hook re-detects edits in a fresh conversation.
//   adr-emitted-hashes.json   — written by post-tool-use.js (current name)
//   adr-session-hashes.json   — written by post-tool-use.js (legacy name, < v0.2)
//   adr-pending-intents.json  — written by user-prompt-submit.js
const sessionFiles = [
  'adr-emitted-hashes.json',
  'adr-session-hashes.json',
  'adr-pending-intents.json',
];

// Persistent state (NOT cleared here):
//   adr-captured-hashes.json  — written by adr-capture skill after a save.
//   Clearing it would re-prompt for ADRs the user has already accepted in
//   prior sessions. Users can delete it manually to reset.

for (const name of sessionFiles) {
  try {
    fs.unlinkSync(path.join(claudeDir, name));
  } catch (_) { /* file didn't exist */ }
}

process.exit(0);
