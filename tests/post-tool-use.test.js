'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function runHook(stdinPayload, { claudeDir, cwd } = {}) {
  const tmpDir = claudeDir || fs.mkdtempSync(path.join(os.tmpdir(), 'adr-ptu-'));
  const result = spawnSync(
    process.execPath,
    [path.resolve(__dirname, '../hooks/post-tool-use.js')],
    {
      input: JSON.stringify(stdinPayload),
      env: { ...process.env, CLAUDE_CONFIG_DIR: tmpDir },
      cwd: cwd || tmpDir,
    }
  );
  return { result, tmpDir };
}

/**
 * Parse the hook stdout. Hook wraps its signal in
 * { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: <signal-json-string> } }
 * — required by Claude Code so the signal is injected into the model context.
 * Returns the inner signal object, or null if stdout was empty.
 */
function parseSignal(stdout) {
  const out = stdout.toString();
  if (!out.length) return null;
  const wrapper = JSON.parse(out);
  assert.equal(wrapper.hookSpecificOutput.hookEventName, 'PostToolUse');
  return JSON.parse(wrapper.hookSpecificOutput.additionalContext);
}

describe('post-tool-use.js', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-ptu-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('emits no output for non-infra file Write', () => {
    const { result } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: 'src/Button.tsx', content: 'migrate to graphql' },
    }, { claudeDir: tmpDir, cwd: tmpDir });
    assert.equal(result.stdout.toString(), '');
    assert.equal(result.status, 0);
  });

  it('emits no output when no decision keyword in diff', () => {
    const { result } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: 'package.json', content: '{"version": "1.0.1"}' },
    }, { claudeDir: tmpDir, cwd: tmpDir });
    assert.equal(result.stdout.toString(), '');
  });

  it('emits wrapped JSON signal for infra file + keyword in Write content', () => {
    const { result } = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: 'package.json',
        content: 'replace axios with graphql-request for all API calls',
      },
    }, { claudeDir: tmpDir, cwd: tmpDir });
    const signal = parseSignal(result.stdout);
    assert.ok(signal, 'expected signal output, got empty');
    assert.equal(signal.signal, 'adr-detected');
    assert.equal(signal.file, 'package.json');
    assert.ok(signal.keyword);
    assert.ok(signal.hash);
  });

  it('emits wrapped JSON signal for infra file + keyword in Edit diff', () => {
    const { result } = runHook({
      tool_name: 'Edit',
      tool_input: {
        file_path: 'requirements.txt',
        old_string: 'sqlalchemy==1.4',
        new_string: 'migrate to peewee==3.17',
      },
    }, { claudeDir: tmpDir, cwd: tmpDir });
    const signal = parseSignal(result.stdout);
    assert.equal(signal.signal, 'adr-detected');
  });

  it('deduplicates: second identical trigger emits no output', () => {
    const payload = {
      tool_name: 'Write',
      tool_input: {
        file_path: 'package.json',
        content: 'replace axios with graphql-request',
      },
    };
    // First call — should emit
    const { result: r1 } = runHook(payload, { claudeDir: tmpDir, cwd: tmpDir });
    assert.ok(parseSignal(r1.stdout));

    // Second call same payload — should be deduped
    const { result: r2 } = runHook(payload, { claudeDir: tmpDir, cwd: tmpDir });
    assert.equal(r2.stdout.toString(), '');
  });

  it('records emitted hash to adr-emitted-hashes.json (not legacy filename)', () => {
    runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: 'package.json',
        content: 'replace axios with graphql-request',
      },
    }, { claudeDir: tmpDir, cwd: tmpDir });
    const newPath = path.join(tmpDir, 'adr-emitted-hashes.json');
    const legacyPath = path.join(tmpDir, 'adr-session-hashes.json');
    assert.ok(fs.existsSync(newPath), 'expected adr-emitted-hashes.json to exist');
    assert.ok(!fs.existsSync(legacyPath), 'legacy adr-session-hashes.json must not be created');
  });

  it('migrates legacy adr-session-hashes.json on first run', () => {
    // Pre-seed legacy file with an existing hash, no new file present.
    const legacyPath = path.join(tmpDir, 'adr-session-hashes.json');
    const newPath = path.join(tmpDir, 'adr-emitted-hashes.json');
    const legacyHash = 'deadbeef';
    fs.writeFileSync(legacyPath, JSON.stringify({ [legacyHash]: '2026-01-01T00:00:00Z' }));

    runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: 'package.json',
        content: 'replace axios with graphql-request',
      },
    }, { claudeDir: tmpDir, cwd: tmpDir });

    assert.ok(!fs.existsSync(legacyPath), 'legacy file must be renamed away');
    assert.ok(fs.existsSync(newPath), 'new file must exist after migration');
    const data = JSON.parse(fs.readFileSync(newPath, 'utf8'));
    assert.ok(data[legacyHash], 'legacy hash entry must be preserved');
  });

  it('does not emit signal for files inside configured adrDir', () => {
    // Default adrDir is docs/adr — writing an ADR file with a decision keyword
    // in its filename + content must NOT re-trigger the hook.
    const { result } = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: 'docs/adr/2026-05-07-migrate-from-axios-to-fetch.md',
        content: '# ADR: Migrate from axios to fetch\n\nDecision: migrate to fetch.',
      },
    }, { claudeDir: tmpDir, cwd: tmpDir });
    assert.equal(result.stdout.toString(), '', 'expected no signal for ADR file');
  });

  it('honors custom adrDir via .adr-config.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.adr-config.json'),
      JSON.stringify({ adrDir: 'architecture/decisions' })
    );
    const { result } = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: 'architecture/decisions/0001-migrate-db.md',
        content: 'migrate to postgres for transactional integrity',
      },
    }, { claudeDir: tmpDir, cwd: tmpDir });
    assert.equal(result.stdout.toString(), '', 'expected no signal for custom adrDir file');
  });

  it('exits 0 on invalid stdin JSON', () => {
    const result = spawnSync(
      process.execPath,
      [path.resolve(__dirname, '../hooks/post-tool-use.js')],
      { input: 'not json', env: { ...process.env, CLAUDE_CONFIG_DIR: tmpDir } }
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout.toString(), '');
  });

  it('exits 0 when tool_input.file_path is missing', () => {
    const { result } = runHook({ tool_name: 'Write', tool_input: {} },
      { claudeDir: tmpDir, cwd: tmpDir });
    assert.equal(result.status, 0);
  });

  it('detects entry-point app.py write with decision keyword', () => {
    const { result } = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '/repo/app.py',
        content: 'import asyncpg\n# migrate to asyncpg from sqlite',
      },
    }, { claudeDir: tmpDir, cwd: tmpDir });
    const signal = parseSignal(result.stdout);
    assert.ok(signal, 'expected signal output for app.py edit');
    assert.equal(signal.signal, 'adr-detected');
    assert.equal(signal.file, '/repo/app.py');
    assert.match(signal.keyword, /migrate to/i);
  });

  it('promotes plain source file via heavy import in diff', () => {
    // src/db_helpers.py is NOT in infraPatterns, but the diff introduces
    // asyncpg — content rule must fire.
    const { result } = runHook({
      tool_name: 'Edit',
      tool_input: {
        file_path: 'src/db_helpers.py',
        old_string: '# placeholder',
        new_string: 'import asyncpg\n# migrate to asyncpg-based pool',
      },
    }, { claudeDir: tmpDir, cwd: tmpDir });
    const signal = parseSignal(result.stdout);
    assert.ok(signal, 'expected signal via content promotion');
    assert.equal(signal.signal, 'adr-detected');
  });

  it('does not detect plain source file without heavy import', () => {
    const { result } = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: 'src/util.py',
        content: '# we will migrate to a new helper later',
      },
    }, { claudeDir: tmpDir, cwd: tmpDir });
    assert.equal(result.stdout.toString(), '');
  });

  it('signal includes recent_intents array when message scanning is on', () => {
    // Pre-seed an intent so we can verify correlation.
    const intentsFile = path.join(tmpDir, 'adr-pending-intents.json');
    fs.writeFileSync(intentsFile, JSON.stringify([
      { keyword: 'migrate to', excerpt: 'we should migrate to asyncpg', recorded_at: '2026-05-07T00:00:00.000Z' },
    ]));

    const { result } = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '/repo/app.py',
        content: 'import asyncpg\n# migrate to asyncpg',
      },
    }, { claudeDir: tmpDir, cwd: tmpDir });
    const signal = parseSignal(result.stdout);
    assert.ok(Array.isArray(signal.recent_intents));
    assert.equal(signal.recent_intents.length, 1);
    assert.equal(signal.recent_intents[0].keyword, 'migrate to');
  });

  it('signal omits intents when enableMessageScanning is disabled', () => {
    // Project-level config disables scanning.
    fs.writeFileSync(
      path.join(tmpDir, '.adr-config.json'),
      JSON.stringify({ enableMessageScanning: false })
    );
    fs.writeFileSync(
      path.join(tmpDir, 'adr-pending-intents.json'),
      JSON.stringify([{ keyword: 'migrate to', excerpt: 'x', recorded_at: 'now' }])
    );
    const { result } = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '/repo/app.py',
        content: 'import asyncpg\n# migrate to asyncpg',
      },
    }, { claudeDir: tmpDir, cwd: tmpDir });
    const signal = parseSignal(result.stdout);
    assert.deepEqual(signal.recent_intents, []);
  });
});
