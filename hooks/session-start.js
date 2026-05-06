#!/usr/bin/env node
// hooks/session-start.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const claudeDir =
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const hashFile = path.join(claudeDir, 'adr-session-hashes.json');

try {
  fs.unlinkSync(hashFile);
} catch (_) { /* file didn't exist — that's fine */ }

process.exit(0);
