'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const EMITTED_HASH_FILENAME = 'adr-emitted-hashes.json';
const LEGACY_HASH_FILENAME = 'adr-session-hashes.json';

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
 * Returns true if filePath resolves inside the configured ADR output
 * directory. Prevents the hook from self-triggering on its own ADR files,
 * whose filenames typically contain decision keywords like "migrate".
 *
 * Both relative and absolute filePath forms are checked. cwd defaults
 * to process.cwd() so tests and runtime callers can override it.
 *
 * @param {string} filePath
 * @param {object} config
 * @param {string} [cwd]
 */
function isInAdrDir(filePath, config, cwd) {
  const adrDirRaw = (config && config.adrDir) || 'docs/adr';
  const adrDirNorm = adrDirRaw.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!adrDirNorm) return false;

  const fileNorm = filePath.replace(/\\/g, '/');
  const cwdNorm = (cwd || process.cwd()).replace(/\\/g, '/');

  if (fileNorm === adrDirNorm || fileNorm.startsWith(adrDirNorm + '/')) {
    return true;
  }

  const absAdrDir = path
    .resolve(cwdNorm, adrDirNorm)
    .split(path.sep)
    .join('/');
  if (fileNorm === absAdrDir || fileNorm.startsWith(absAdrDir + '/')) {
    return true;
  }

  return false;
}

/**
 * A file qualifies as infrastructure if EITHER its path matches a known
 * pattern OR its diff text introduces a heavy/architectural import. The
 * second criterion catches decisions made in plain source files (e.g.
 * adopting asyncpg inside app.py) that path rules alone would miss.
 *
 * Files inside the configured ADR directory are excluded up-front so the
 * hook never re-triggers on the markdown documents it produces.
 *
 * @param {string} filePath
 * @param {object} config
 * @param {string} [diffText] - Write content or Edit old+new strings concatenated.
 * @param {string} [cwd]
 */
function isInfraFile(filePath, config, diffText = '', cwd) {
  if (isInAdrDir(filePath, config, cwd)) return false;
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

function _claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function _emittedHashFilePath() {
  return path.join(_claudeDir(), EMITTED_HASH_FILENAME);
}

/**
 * One-time migration: if a user has the legacy adr-session-hashes.json
 * from plugin v0.1.0 and no new file yet, rename it. Idempotent — runs
 * before any read/write of the emitted-hashes file.
 */
function _migrateLegacyHashFile() {
  const legacy = path.join(_claudeDir(), LEGACY_HASH_FILENAME);
  const current = _emittedHashFilePath();
  try {
    if (fs.existsSync(legacy) && !fs.existsSync(current)) {
      fs.renameSync(legacy, current);
    }
  } catch (_) { /* best-effort — never disrupt the hook */ }
}

function isDeduped(hash) {
  _migrateLegacyHashFile();
  try {
    const data = JSON.parse(fs.readFileSync(_emittedHashFilePath(), 'utf8'));
    return Object.prototype.hasOwnProperty.call(data, hash);
  } catch (_) {
    return false;
  }
}

function recordHash(hash) {
  _migrateLegacyHashFile();
  const filePath = _emittedHashFilePath();
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) { /* fresh — start empty */ }
  data[hash] = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

module.exports = {
  isInfraFile,
  isInAdrDir,
  matchesInfraContent,
  findDecisionKeyword,
  computeHash,
  isDeduped,
  recordHash,
  EMITTED_HASH_FILENAME,
  LEGACY_HASH_FILENAME,
};
