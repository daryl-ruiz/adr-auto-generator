'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('adr-config loadConfig', () => {
  let tmpDir;
  let origEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-cfg-'));
    origEnv = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (origEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = origEnv;
  });

  it('returns default adrDir when no config files exist', () => {
    const { loadConfig } = require('../hooks/adr-config');
    const config = loadConfig(tmpDir, tmpDir);
    assert.equal(config.adrDir, 'docs/adr');
  });

  it('global config overrides default adrDir', () => {
    const { loadConfig } = require('../hooks/adr-config');
    fs.writeFileSync(
      path.join(tmpDir, 'adr-config.json'),
      JSON.stringify({ adrDir: 'global/adr' })
    );
    const config = loadConfig(tmpDir, tmpDir);
    assert.equal(config.adrDir, 'global/adr');
  });

  it('project config overrides global adrDir', () => {
    const { loadConfig } = require('../hooks/adr-config');
    fs.writeFileSync(
      path.join(tmpDir, 'adr-config.json'),
      JSON.stringify({ adrDir: 'global/adr' })
    );
    fs.writeFileSync(
      path.join(tmpDir, '.adr-config.json'),
      JSON.stringify({ adrDir: 'project/adr' })
    );
    const config = loadConfig(tmpDir, tmpDir);
    assert.equal(config.adrDir, 'project/adr');
  });

  it('project config replaces decisionKeywords array entirely', () => {
    const { loadConfig } = require('../hooks/adr-config');
    fs.writeFileSync(
      path.join(tmpDir, '.adr-config.json'),
      JSON.stringify({ decisionKeywords: ['custom signal'] })
    );
    const config = loadConfig(tmpDir, tmpDir);
    assert.deepEqual(config.decisionKeywords, ['custom signal']);
  });

  it('returns enableMessageScanning false by default', () => {
    const { loadConfig } = require('../hooks/adr-config');
    const config = loadConfig(tmpDir, tmpDir);
    assert.equal(config.enableMessageScanning, false);
  });

  it('missing config files do not throw', () => {
    const { loadConfig } = require('../hooks/adr-config');
    assert.doesNotThrow(() => loadConfig('/nonexistent/cwd', '/nonexistent/claudedir'));
  });
});
