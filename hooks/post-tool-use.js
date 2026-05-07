#!/usr/bin/env node
// hooks/post-tool-use.js
'use strict';
const { loadConfig } = require('./adr-config');
const {
  isInfraFile,
  findDecisionKeyword,
  computeHash,
  isDeduped,
  recordHash,
} = require('./detector');
const { loadIntents } = require('./intents');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(raw);
    const toolName = data.tool_name;
    const toolInput = data.tool_input || {};
    const filePath = toolInput.file_path || '';

    if (!filePath) { process.exit(0); }

    // Build diff text from tool input fields
    let diffText = '';
    if (toolName === 'Write') {
      diffText = toolInput.content || '';
    } else if (toolName === 'Edit') {
      diffText = `${toolInput.old_string || ''} ${toolInput.new_string || ''}`;
    }

    const config = loadConfig(process.cwd());

    if (!isInfraFile(filePath, config, diffText)) { process.exit(0); }

    const keyword = findDecisionKeyword(diffText, config);
    if (!keyword) { process.exit(0); }

    const hash = computeHash(filePath, keyword);
    if (isDeduped(hash)) { process.exit(0); }

    recordHash(hash);

    // Correlate with any pending message-scanned intents so the ADR
    // context can include why the user wanted this change.
    const recentIntents = config.enableMessageScanning ? loadIntents() : [];

    process.stdout.write(JSON.stringify({
      signal: 'adr-detected',
      file: filePath,
      keyword,
      hash,
      recent_intents: recentIntents,
    }));
  } catch (_) {
    // Silent fail — never disrupt Claude
  }
  process.exit(0);
});
