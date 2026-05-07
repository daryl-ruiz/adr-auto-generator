'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('intents store', () => {
  let tmpDir, origEnv;
  let loadIntents, recordIntent, clearIntents, MAX_INTENTS;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-intents-'));
    origEnv = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = tmpDir;
    delete require.cache[require.resolve('../hooks/intents')];
    ({ loadIntents, recordIntent, clearIntents, MAX_INTENTS } = require('../hooks/intents'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (origEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = origEnv;
  });

  it('loadIntents returns empty array when file missing', () => {
    assert.deepEqual(loadIntents(), []);
  });

  it('recordIntent persists keyword + excerpt + timestamp', () => {
    recordIntent({ keyword: 'migrate to', prompt: 'we should migrate to asyncpg' });
    const intents = loadIntents();
    assert.equal(intents.length, 1);
    assert.equal(intents[0].keyword, 'migrate to');
    assert.match(intents[0].excerpt, /asyncpg/);
    assert.match(intents[0].recorded_at, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('recordIntent appends without losing prior entries', () => {
    recordIntent({ keyword: 'migrate to', prompt: 'first' });
    recordIntent({ keyword: 'switch to', prompt: 'second' });
    const intents = loadIntents();
    assert.equal(intents.length, 2);
    assert.equal(intents[0].excerpt, 'first');
    assert.equal(intents[1].excerpt, 'second');
  });

  it('excerpt is truncated to 240 characters', () => {
    const longPrompt = 'x'.repeat(500);
    recordIntent({ keyword: 'migrate to', prompt: longPrompt });
    const [entry] = loadIntents();
    assert.equal(entry.excerpt.length, 240);
  });

  it('store trims to MAX_INTENTS most-recent entries', () => {
    for (let i = 0; i < MAX_INTENTS + 10; i++) {
      recordIntent({ keyword: 'migrate to', prompt: `entry ${i}` });
    }
    const intents = loadIntents();
    assert.equal(intents.length, MAX_INTENTS);
    // Oldest 10 should be dropped — first surviving entry is index 10.
    assert.equal(intents[0].excerpt, 'entry 10');
  });

  it('clearIntents removes the file', () => {
    recordIntent({ keyword: 'migrate to', prompt: 'x' });
    clearIntents();
    assert.deepEqual(loadIntents(), []);
  });

  it('loadIntents tolerates corrupt JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'adr-pending-intents.json'), 'not json');
    assert.deepEqual(loadIntents(), []);
  });

  it('loadIntents tolerates non-array JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'adr-pending-intents.json'), '{"foo":"bar"}');
    assert.deepEqual(loadIntents(), []);
  });
});
