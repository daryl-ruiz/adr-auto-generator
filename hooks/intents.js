'use strict';
// Pending-intent store.
// User messages can hint at architectural decisions before any file is
// edited (e.g. "let's migrate to asyncpg"). UserPromptSubmit records
// these hints; PostToolUse later correlates them with detected file
// changes to enrich the ADR signal.
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_INTENTS = 50;

function _intentsFilePath() {
  const claudeDir =
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(claudeDir, 'adr-pending-intents.json');
}

function loadIntents() {
  try {
    const data = JSON.parse(fs.readFileSync(_intentsFilePath(), 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function saveIntents(intents) {
  const trimmed = intents.slice(-MAX_INTENTS);
  fs.writeFileSync(_intentsFilePath(), JSON.stringify(trimmed, null, 2));
}

function recordIntent({ keyword, prompt }) {
  const excerpt = (prompt || '').slice(0, 240);
  const entry = {
    keyword,
    excerpt,
    recorded_at: new Date().toISOString(),
  };
  const intents = loadIntents();
  intents.push(entry);
  saveIntents(intents);
  return entry;
}

function clearIntents() {
  try {
    fs.unlinkSync(_intentsFilePath());
  } catch (_) { /* file didn't exist */ }
}

module.exports = {
  loadIntents,
  saveIntents,
  recordIntent,
  clearIntents,
  MAX_INTENTS,
};
