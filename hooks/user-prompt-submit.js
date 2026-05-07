#!/usr/bin/env node
// hooks/user-prompt-submit.js
// When enableMessageScanning is on, scan the user's prompt for decision
// keywords. Matches are appended to the pending-intents store so a later
// PostToolUse hook can correlate them with the file change that lands
// the decision (e.g. user says "migrate to asyncpg" → later edits app.py).
'use strict';
const { loadConfig } = require('./adr-config');
const { findDecisionKeyword } = require('./detector');
const { recordIntent } = require('./intents');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const data = raw ? JSON.parse(raw) : {};
    const prompt = data.prompt || '';
    if (!prompt) { process.exit(0); }

    const config = loadConfig(process.cwd());
    if (!config.enableMessageScanning) { process.exit(0); }

    const keyword = findDecisionKeyword(prompt, config);
    if (!keyword) { process.exit(0); }

    recordIntent({ keyword, prompt });
  } catch (_) {
    // Silent fail — never disrupt Claude
  }
  process.exit(0);
});
