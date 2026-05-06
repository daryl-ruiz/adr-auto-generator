'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('session-start.js', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-ss-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runHook(claudeDir) {
    return spawnSync(
      process.execPath,
      [path.resolve(__dirname, '../hooks/session-start.js')],
      { env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir } }
    );
  }

  it('exits 0', () => {
    const result = runHook(tmpDir);
    assert.equal(result.status, 0);
  });

  it('deletes adr-session-hashes.json when it exists', () => {
    const hashFile = path.join(tmpDir, 'adr-session-hashes.json');
    fs.writeFileSync(hashFile, '{"abc":"2026-01-01"}');
    runHook(tmpDir);
    assert.ok(!fs.existsSync(hashFile));
  });

  it('does not throw when adr-session-hashes.json does not exist', () => {
    const result = runHook(tmpDir);
    assert.equal(result.status, 0);
    assert.equal(result.stderr.toString(), '');
  });

  it('emits no stdout', () => {
    const result = runHook(tmpDir);
    assert.equal(result.stdout.toString(), '');
  });
});
