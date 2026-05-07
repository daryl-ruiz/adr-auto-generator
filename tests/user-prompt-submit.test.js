'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function runHook(stdinPayload, { claudeDir, cwd }) {
  return spawnSync(
    process.execPath,
    [path.resolve(__dirname, '../hooks/user-prompt-submit.js')],
    {
      input: JSON.stringify(stdinPayload),
      env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir },
      cwd: cwd || claudeDir,
    }
  );
}

describe('user-prompt-submit.js', () => {
  let tmpDir;
  const intentsName = 'adr-pending-intents.json';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-ups-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits 0 with no stdout', () => {
    const result = runHook({ prompt: 'migrate to asyncpg' }, { claudeDir: tmpDir });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.toString(), '');
  });

  it('records intent when prompt contains a decision keyword', () => {
    runHook({ prompt: "let's migrate to asyncpg for the DB layer" },
      { claudeDir: tmpDir });
    const file = path.join(tmpDir, intentsName);
    assert.ok(fs.existsSync(file), 'intents file should exist after match');
    const intents = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(intents.length, 1);
    assert.match(intents[0].keyword, /migrate to/i);
    assert.match(intents[0].excerpt, /asyncpg/);
  });

  it('does not record when prompt has no decision keyword', () => {
    runHook({ prompt: 'fix typo in readme' }, { claudeDir: tmpDir });
    assert.ok(!fs.existsSync(path.join(tmpDir, intentsName)));
  });

  it('does not record when enableMessageScanning is disabled in project config', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.adr-config.json'),
      JSON.stringify({ enableMessageScanning: false })
    );
    runHook({ prompt: 'migrate to asyncpg' }, { claudeDir: tmpDir, cwd: tmpDir });
    assert.ok(!fs.existsSync(path.join(tmpDir, intentsName)));
  });

  it('appends across multiple invocations', () => {
    runHook({ prompt: 'migrate to asyncpg' }, { claudeDir: tmpDir });
    runHook({ prompt: 'switch to redis for caching' }, { claudeDir: tmpDir });
    const intents = JSON.parse(fs.readFileSync(path.join(tmpDir, intentsName), 'utf8'));
    assert.equal(intents.length, 2);
  });

  it('exits 0 on invalid stdin JSON', () => {
    const result = spawnSync(
      process.execPath,
      [path.resolve(__dirname, '../hooks/user-prompt-submit.js')],
      { input: 'not json', env: { ...process.env, CLAUDE_CONFIG_DIR: tmpDir } }
    );
    assert.equal(result.status, 0);
    assert.ok(!fs.existsSync(path.join(tmpDir, intentsName)));
  });

  it('exits 0 with empty stdin', () => {
    const result = spawnSync(
      process.execPath,
      [path.resolve(__dirname, '../hooks/user-prompt-submit.js')],
      { input: '', env: { ...process.env, CLAUDE_CONFIG_DIR: tmpDir } }
    );
    assert.equal(result.status, 0);
  });

  it('exits 0 when prompt key missing', () => {
    const result = runHook({ other: 'data' }, { claudeDir: tmpDir });
    assert.equal(result.status, 0);
    assert.ok(!fs.existsSync(path.join(tmpDir, intentsName)));
  });
});
