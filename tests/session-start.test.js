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

  it('deletes adr-emitted-hashes.json when it exists', () => {
    const hashFile = path.join(tmpDir, 'adr-emitted-hashes.json');
    fs.writeFileSync(hashFile, '{"abc":"2026-01-01"}');
    runHook(tmpDir);
    assert.ok(!fs.existsSync(hashFile));
  });

  it('also deletes legacy adr-session-hashes.json when it exists', () => {
    const legacy = path.join(tmpDir, 'adr-session-hashes.json');
    fs.writeFileSync(legacy, '{"abc":"2026-01-01"}');
    runHook(tmpDir);
    assert.ok(!fs.existsSync(legacy));
  });

  it('does not throw when no session files exist', () => {
    const result = runHook(tmpDir);
    assert.equal(result.status, 0);
    assert.equal(result.stderr.toString(), '');
  });

  it('emits no stdout', () => {
    const result = runHook(tmpDir);
    assert.equal(result.stdout.toString(), '');
  });

  it('deletes adr-pending-intents.json when it exists', () => {
    const intentsFile = path.join(tmpDir, 'adr-pending-intents.json');
    fs.writeFileSync(intentsFile, JSON.stringify([{ keyword: 'x' }]));
    runHook(tmpDir);
    assert.ok(!fs.existsSync(intentsFile));
  });

  it('clears all session files in a single session start', () => {
    const emitted = path.join(tmpDir, 'adr-emitted-hashes.json');
    const legacy = path.join(tmpDir, 'adr-session-hashes.json');
    const intents = path.join(tmpDir, 'adr-pending-intents.json');
    fs.writeFileSync(emitted, '{"abc":"x"}');
    fs.writeFileSync(legacy, '{"def":"y"}');
    fs.writeFileSync(intents, '[]');
    runHook(tmpDir);
    assert.ok(!fs.existsSync(emitted));
    assert.ok(!fs.existsSync(legacy));
    assert.ok(!fs.existsSync(intents));
  });

  it('does NOT delete adr-captured-hashes.json (persistent across sessions)', () => {
    const captured = path.join(tmpDir, 'adr-captured-hashes.json');
    const payload = '{"abc123":{"capturedAt":"2026-05-07T00:00:00Z","path":"docs/adr/x.md"}}';
    fs.writeFileSync(captured, payload);
    runHook(tmpDir);
    assert.ok(fs.existsSync(captured), 'captured-hashes must persist across session starts');
    assert.equal(fs.readFileSync(captured, 'utf8'), payload, 'captured-hashes content must be unchanged');
  });
});
