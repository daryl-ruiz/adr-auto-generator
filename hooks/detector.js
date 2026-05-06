'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function isInfraFile(filePath, config) {
  const normalized = filePath.replace(/\\/g, '/');
  const basename = path.basename(normalized);
  const lowerBasename = basename.toLowerCase();

  for (const pattern of config.infraPatterns) {
    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1); // e.g. '.tf'
      if (basename.endsWith(ext)) return true;
    } else {
      if (basename === pattern) return true;
    }
  }

  for (const prefix of config.infraPathPrefixes) {
    if (normalized.includes(prefix)) return true;
  }

  for (const namePattern of config.infraNamePatterns) {
    if (lowerBasename.includes(namePattern)) return true;
  }

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

// Placeholder exports — hash/dedup added in Task 4
module.exports = { isInfraFile, findDecisionKeyword };
