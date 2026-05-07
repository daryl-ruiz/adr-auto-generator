'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function _matchesPathPatterns(filePath, config) {
  const normalized = filePath.replace(/\\/g, '/');
  const basename = path.basename(normalized);
  const lowerBasename = basename.toLowerCase();

  for (const pattern of config.infraPatterns || []) {
    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1); // e.g. '.tf'
      if (basename.endsWith(ext)) return true;
    } else {
      if (basename === pattern) return true;
    }
  }

  for (const prefix of config.infraPathPrefixes || []) {
    if (normalized.includes(prefix)) return true;
  }

  for (const namePattern of config.infraNamePatterns || []) {
    if (lowerBasename.includes(namePattern)) return true;
  }

  return false;
}

function matchesInfraContent(diffText, config) {
  if (!diffText) return false;
  const patterns = config.infraContentPatterns || [];
  for (const pattern of patterns) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(diffText)) return true;
  }
  return false;
}

/**
 * A file qualifies as infrastructure if EITHER its path matches a known
 * pattern OR its diff text introduces a heavy/architectural import. The
 * second criterion catches decisions made in plain source files (e.g.
 * adopting asyncpg inside app.py) that path rules alone would miss.
 *
 * @param {string} filePath
 * @param {object} config
 * @param {string} [diffText] - Write content or Edit old+new strings concatenated.
 */
function isInfraFile(filePath, config, diffText = '') {
  if (_matchesPathPatterns(filePath, config)) return true;
  if (matchesInfraContent(diffText, config)) return true;
  return false;
}

function findDecisionKeyword(text, config) {
  for (const keyword of config.decisionKeywords) {
    const regex = new RegExp(keyword, 'i');
    const match = text.match(regex);
    if (match) return match[0];
  }
  return null;
}

function computeHash(filePath, keyword) {
  return crypto
    .createHash('md5')
    .update(filePath + '|' + keyword)
    .digest('hex')
    .slice(0, 8);
}

function _hashFilePath() {
  const claudeDir =
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(claudeDir, 'adr-session-hashes.json');
}

function isDeduped(hash) {
  try {
    const data = JSON.parse(fs.readFileSync(_hashFilePath(), 'utf8'));
    return Object.prototype.hasOwnProperty.call(data, hash);
  } catch (_) {
    return false;
  }
}

function recordHash(hash) {
  const filePath = _hashFilePath();
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) { /* fresh — start empty */ }
  data[hash] = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

module.exports = {
  isInfraFile,
  matchesInfraContent,
  findDecisionKeyword,
  computeHash,
  isDeduped,
  recordHash,
};
