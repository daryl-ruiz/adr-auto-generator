#!/usr/bin/env node
// hooks/session-start.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const claudeDir =
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const hashFile = path.join(claudeDir, 'adr-session-hashes.json');
const intentsFile = path.join(claudeDir, 'adr-pending-intents.json');

for (const f of [hashFile, intentsFile]) {
  try { fs.unlinkSync(f); } catch (_) { /* file didn't exist */ }
}

process.exit(0);
