# ADR Auto Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code plugin that detects architectural decisions from file edits and guides the user through capturing them as Nygard-style ADR documents.

**Architecture:** Hook = sensor (PostToolUse on Write/Edit detects infra file + decision keyword in diff, emits compact JSON signal). Skill = actor (adr-capture SKILL.md owns prompt → extract → template → inline edit → save). Config loader merges global `~/.claude/adr-config.json` with per-project `.adr-config.json` (shallow merge, project wins).

**Tech Stack:** Node.js 18+ (CommonJS), `node:test` (built-in test runner), `node:crypto` (hashing), `node:fs` / `node:path` / `node:os` (stdlib only — zero external dependencies)

---

## File Map

| Path | Type | Responsibility |
|------|------|---------------|
| `package.json` | create | Plugin root metadata |
| `CLAUDE.md` | create | Directive: invoke adr-capture skill on signal |
| `hooks/package.json` | create | `{"type":"commonjs"}` — required for hooks |
| `hooks/hooks.json` | create | Registers SessionStart, PostToolUse (×2), UserPromptSubmit hooks |
| `hooks/adr-config.js` | create | Config loader: global + project shallow merge |
| `hooks/detector.js` | create | Pure detection logic: isInfraFile, findDecisionKeyword, computeHash, isDeduped, recordHash |
| `hooks/session-start.js` | create | Clears `~/.claude/adr-session-hashes.json` on session start |
| `hooks/post-tool-use.js` | create | Stdin entrypoint: orchestrates detection pipeline, emits signal |
| `hooks/user-prompt-submit.js` | create | No-op placeholder (v2: message scanning) |
| `skills/adr-capture/SKILL.md` | create | Full ADR flow: prompt, extract, template, edit, save |
| `tests/adr-config.test.js` | create | Config merge behavior tests |
| `tests/detector.test.js` | create | isInfraFile, findDecisionKeyword, hash, dedup tests |
| `tests/post-tool-use.test.js` | create | Integration test: stdin → stdout signal |
| `README.md` | create | Install, config, sensitivity tuning, example output |

---

## Task 1: Bootstrap Plugin Structure

**Files:**
- Create: `package.json`
- Create: `hooks/package.json`
- Create: `hooks/`, `skills/adr-capture/`, `tests/` directories

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "adr-auto-generator",
  "version": "1.0.0",
  "description": "Detects architectural decisions from file edits and captures them as ADR documents",
  "scripts": {
    "test": "node --test tests/*.test.js"
  }
}
```

Save to: `package.json`

- [ ] **Step 2: Create hooks/package.json**

```json
{
  "type": "commonjs"
}
```

Save to: `hooks/package.json`

- [ ] **Step 3: Create directory structure**

```bash
mkdir -p hooks skills/adr-capture tests
```

- [ ] **Step 4: Commit**

```bash
git init
git add package.json hooks/package.json
git commit -m "chore: bootstrap plugin structure"
```

---

## Task 2: Config Loader — adr-config.js (TDD)

**Files:**
- Create: `tests/adr-config.test.js`
- Create: `hooks/adr-config.js`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/adr-config.test.js
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
```

- [ ] **Step 2: Run tests — expect failure**

```bash
node --test tests/adr-config.test.js 2>&1 | head -20
```

Expected: `Error: Cannot find module '../hooks/adr-config'`

- [ ] **Step 3: Implement hooks/adr-config.js**

```javascript
// hooks/adr-config.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_CONFIG = {
  adrDir: 'docs/adr',
  infraPatterns: [
    'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'requirements.txt', 'setup.py', 'pyproject.toml', 'Pipfile', 'Pipfile.lock',
    'pom.xml', 'build.gradle',
    'Dockerfile', 'docker-compose.yml',
    '*.tf', '*.tfvars', '*.hcl',
    'Makefile',
    '*.config.js', '*.config.ts', '*.config.mjs',
  ],
  infraPathPrefixes: [
    '.github/workflows/',
    '.gitlab-ci.yml',
    'config/',
    'infra/',
    'deploy/',
  ],
  infraNamePatterns: [
    'migration', 'migrate', 'schema', 'seed',
  ],
  decisionKeywords: [
    'migrate (from|to)',
    'switch (from|to)',
    'replace .+ with',
    'moving? to',
    'adopt(ing)?',
    'deprecat(e|ing|ed)',
    'use .+ instead( of)?',
    'refactor .+ to',
    'convert .+ to',
    'port .+ to',
    'new architecture',
    'redesign',
    'overhaul',
    'drop .+ (in favor|for)',
  ],
  enableMessageScanning: false,
};

/**
 * @param {string} [cwd] - project root for .adr-config.json lookup
 * @param {string} [claudeDir] - override ~/.claude dir (used in tests)
 */
function loadConfig(cwd, claudeDir) {
  const effectiveClaudeDir =
    claudeDir ||
    process.env.CLAUDE_CONFIG_DIR ||
    path.join(os.homedir(), '.claude');
  const effectiveCwd = cwd || process.cwd();

  const globalConfigPath = path.join(effectiveClaudeDir, 'adr-config.json');
  const projectConfigPath = path.join(effectiveCwd, '.adr-config.json');

  let globalConfig = {};
  let projectConfig = {};

  try {
    globalConfig = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
  } catch (_) { /* no global config — use defaults */ }

  try {
    projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
  } catch (_) { /* no project config — use global/defaults */ }

  // Shallow merge: project wins over global wins over defaults
  return Object.assign({}, DEFAULT_CONFIG, globalConfig, projectConfig);
}

module.exports = { loadConfig, DEFAULT_CONFIG };
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
node --test tests/adr-config.test.js
```

Expected: `✓ adr-config loadConfig > returns default adrDir when no config files exist` (×6 passing)

- [ ] **Step 5: Commit**

```bash
git add hooks/adr-config.js tests/adr-config.test.js
git commit -m "feat: add config loader with global/project merge"
```

---

## Task 3: Detection Logic — detector.js isInfraFile + findDecisionKeyword (TDD)

**Files:**
- Create: `tests/detector.test.js` (partial — infra + keyword sections)
- Create: `hooks/detector.js` (partial — these two functions)

- [ ] **Step 1: Write failing tests for isInfraFile and findDecisionKeyword**

```javascript
// tests/detector.test.js
'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const INFRA_CONFIG = {
  infraPatterns: [
    'package.json', 'docker-compose.yml', '*.tf', 'Makefile', 'requirements.txt',
    '*.config.js',
  ],
  infraPathPrefixes: ['.github/workflows/', 'config/'],
  infraNamePatterns: ['migration', 'schema'],
};

describe('isInfraFile', () => {
  let isInfraFile;
  beforeEach(() => {
    // clear require cache so each test gets a fresh module
    delete require.cache[require.resolve('../hooks/detector')];
    ({ isInfraFile } = require('../hooks/detector'));
  });

  it('matches exact filename', () => {
    assert.ok(isInfraFile('project/package.json', INFRA_CONFIG));
  });

  it('matches glob *.tf extension', () => {
    assert.ok(isInfraFile('infra/main.tf', INFRA_CONFIG));
  });

  it('matches glob *.config.js extension', () => {
    assert.ok(isInfraFile('src/vite.config.js', INFRA_CONFIG));
  });

  it('matches path prefix .github/workflows/', () => {
    assert.ok(isInfraFile('.github/workflows/ci.yml', INFRA_CONFIG));
  });

  it('matches name pattern "migration"', () => {
    assert.ok(isInfraFile('db/20240101_migration.sql', INFRA_CONFIG));
  });

  it('matches name pattern "schema"', () => {
    assert.ok(isInfraFile('prisma/schema.prisma', INFRA_CONFIG));
  });

  it('returns false for plain source file', () => {
    assert.ok(!isInfraFile('src/components/Button.tsx', INFRA_CONFIG));
  });

  it('returns false for test file', () => {
    assert.ok(!isInfraFile('tests/auth.test.js', INFRA_CONFIG));
  });

  it('handles Windows-style backslash paths', () => {
    assert.ok(isInfraFile('.github\\workflows\\ci.yml', INFRA_CONFIG));
  });
});

const KEYWORD_CONFIG = {
  decisionKeywords: [
    'migrate (from|to)',
    'replace .+ with',
    'switch (from|to)',
    'deprecat(e|ing|ed)',
  ],
};

describe('findDecisionKeyword', () => {
  let findDecisionKeyword;
  beforeEach(() => {
    delete require.cache[require.resolve('../hooks/detector')];
    ({ findDecisionKeyword } = require('../hooks/detector'));
  });

  it('finds "migrate to" pattern', () => {
    const result = findDecisionKeyword('we migrate to postgres', KEYWORD_CONFIG);
    assert.ok(result);
    assert.match(result, /migrate to/i);
  });

  it('finds "replace X with Y" pattern', () => {
    const result = findDecisionKeyword('replace axios with graphql-request', KEYWORD_CONFIG);
    assert.ok(result);
  });

  it('finds "deprecating" pattern', () => {
    const result = findDecisionKeyword('we are deprecating the REST API', KEYWORD_CONFIG);
    assert.ok(result);
  });

  it('returns null when no keyword matches', () => {
    const result = findDecisionKeyword('just bumping the version number', KEYWORD_CONFIG);
    assert.equal(result, null);
  });

  it('is case-insensitive', () => {
    const result = findDecisionKeyword('MIGRATE FROM MySQL TO Postgres', KEYWORD_CONFIG);
    assert.ok(result);
  });

  it('returns the matched string, not the pattern', () => {
    const result = findDecisionKeyword('we migrate to redis', KEYWORD_CONFIG);
    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
node --test tests/detector.test.js 2>&1 | head -5
```

Expected: `Error: Cannot find module '../hooks/detector'`

- [ ] **Step 3: Implement isInfraFile and findDecisionKeyword in hooks/detector.js**

```javascript
// hooks/detector.js
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
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
node --test tests/detector.test.js 2>&1 | grep -E '(✓|✗|pass|fail)'
```

Expected: all `isInfraFile` and `findDecisionKeyword` tests passing.

- [ ] **Step 5: Commit**

```bash
git add hooks/detector.js tests/detector.test.js
git commit -m "feat: add infra file detection and keyword matching"
```

---

## Task 4: Detection Logic — computeHash, isDeduped, recordHash (TDD)

**Files:**
- Modify: `tests/detector.test.js` — append hash/dedup test blocks
- Modify: `hooks/detector.js` — add hash/dedup functions + update exports

- [ ] **Step 1: Append hash and dedup tests to tests/detector.test.js**

Append after the last `describe` block in `tests/detector.test.js`:

```javascript
describe('computeHash', () => {
  let computeHash;
  beforeEach(() => {
    delete require.cache[require.resolve('../hooks/detector')];
    ({ computeHash } = require('../hooks/detector'));
  });

  it('same inputs produce same hash', () => {
    assert.equal(
      computeHash('src/db.js', 'migrate to'),
      computeHash('src/db.js', 'migrate to')
    );
  });

  it('different file path produces different hash', () => {
    assert.notEqual(
      computeHash('src/a.js', 'migrate to'),
      computeHash('src/b.js', 'migrate to')
    );
  });

  it('different keyword produces different hash', () => {
    assert.notEqual(
      computeHash('src/a.js', 'migrate to'),
      computeHash('src/a.js', 'switch from')
    );
  });

  it('returns 8-character hex string', () => {
    const h = computeHash('file', 'kw');
    assert.match(h, /^[0-9a-f]{8}$/);
  });
});

describe('isDeduped / recordHash', () => {
  let tmpDir, origEnv, isDeduped, recordHash;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-dedup-'));
    origEnv = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = tmpDir;
    delete require.cache[require.resolve('../hooks/detector')];
    ({ isDeduped, recordHash } = require('../hooks/detector'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (origEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = origEnv;
  });

  it('returns false when hash not seen', () => {
    assert.ok(!isDeduped('abc123'));
  });

  it('returns true after recordHash', () => {
    recordHash('abc123');
    assert.ok(isDeduped('abc123'));
  });

  it('returns false for a different hash', () => {
    recordHash('abc123');
    assert.ok(!isDeduped('def456'));
  });

  it('persists multiple hashes', () => {
    recordHash('hash1');
    recordHash('hash2');
    assert.ok(isDeduped('hash1'));
    assert.ok(isDeduped('hash2'));
  });

  it('recordHash is idempotent', () => {
    recordHash('abc123');
    recordHash('abc123');
    assert.ok(isDeduped('abc123'));
  });
});
```

- [ ] **Step 2: Run tests — expect new tests fail**

```bash
node --test tests/detector.test.js 2>&1 | grep -E '(✗|not ok)'
```

Expected: `computeHash` and `isDeduped/recordHash` tests fail with "not a function".

- [ ] **Step 3: Add hash/dedup functions to hooks/detector.js**

Replace the existing `module.exports` line and add below `findDecisionKeyword`:

```javascript
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

module.exports = { isInfraFile, findDecisionKeyword, computeHash, isDeduped, recordHash };
```

Replace the old `module.exports` line at the end of `hooks/detector.js`:
```javascript
module.exports = { isInfraFile, findDecisionKeyword };
```

- [ ] **Step 4: Run all detector tests — expect all pass**

```bash
node --test tests/detector.test.js
```

Expected: all tests pass (no failures).

- [ ] **Step 5: Commit**

```bash
git add hooks/detector.js tests/detector.test.js
git commit -m "feat: add hash computation and session dedup to detector"
```

---

## Task 5: Session-Start Hook (TDD)

**Files:**
- Create: `tests/session-start.test.js`
- Create: `hooks/session-start.js`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/session-start.test.js
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
```

- [ ] **Step 2: Run tests — expect failure**

```bash
node --test tests/session-start.test.js 2>&1 | head -5
```

Expected: `Error: spawnSync` or script not found error.

- [ ] **Step 3: Implement hooks/session-start.js**

```javascript
#!/usr/bin/env node
// hooks/session-start.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const claudeDir =
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const hashFile = path.join(claudeDir, 'adr-session-hashes.json');

try {
  fs.unlinkSync(hashFile);
} catch (_) { /* file didn't exist — that's fine */ }

process.exit(0);
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
node --test tests/session-start.test.js
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add hooks/session-start.js tests/session-start.test.js
git commit -m "feat: add session-start hook to clear dedup hashes"
```

---

## Task 6: PostToolUse Entrypoint — post-tool-use.js (TDD)

**Files:**
- Create: `tests/post-tool-use.test.js`
- Create: `hooks/post-tool-use.js`

- [ ] **Step 1: Write integration tests**

```javascript
// tests/post-tool-use.test.js
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

  it('emits JSON signal for infra file + keyword in Write content', () => {
    const { result } = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: 'package.json',
        content: 'replace axios with graphql-request for all API calls',
      },
    }, { claudeDir: tmpDir, cwd: tmpDir });
    const out = result.stdout.toString();
    assert.ok(out.length > 0, 'expected signal output, got empty');
    const signal = JSON.parse(out);
    assert.equal(signal.signal, 'adr-detected');
    assert.equal(signal.file, 'package.json');
    assert.ok(signal.keyword);
    assert.ok(signal.hash);
  });

  it('emits JSON signal for infra file + keyword in Edit diff', () => {
    const { result } = runHook({
      tool_name: 'Edit',
      tool_input: {
        file_path: 'requirements.txt',
        old_string: 'sqlalchemy==1.4',
        new_string: 'migrate to peewee==3.17',
      },
    }, { claudeDir: tmpDir, cwd: tmpDir });
    const out = result.stdout.toString();
    const signal = JSON.parse(out);
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
    assert.ok(r1.stdout.toString().length > 0);

    // Second call same payload — should be deduped
    const { result: r2 } = runHook(payload, { claudeDir: tmpDir, cwd: tmpDir });
    assert.equal(r2.stdout.toString(), '');
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
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
node --test tests/post-tool-use.test.js 2>&1 | head -5
```

Expected: script not found or import error.

- [ ] **Step 3: Implement hooks/post-tool-use.js**

```javascript
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

    if (!isInfraFile(filePath, config)) { process.exit(0); }

    const keyword = findDecisionKeyword(diffText, config);
    if (!keyword) { process.exit(0); }

    const hash = computeHash(filePath, keyword);
    if (isDeduped(hash)) { process.exit(0); }

    recordHash(hash);

    process.stdout.write(JSON.stringify({
      signal: 'adr-detected',
      file: filePath,
      keyword,
      hash,
    }));
  } catch (_) {
    // Silent fail — never disrupt Claude
  }
  process.exit(0);
});
```

- [ ] **Step 4: Run all tests — expect all pass**

```bash
node --test tests/post-tool-use.test.js
```

Expected: 7 passing.

- [ ] **Step 5: Run full suite**

```bash
node --test tests/*.test.js
```

Expected: all tests passing.

- [ ] **Step 6: Commit**

```bash
git add hooks/post-tool-use.js tests/post-tool-use.test.js
git commit -m "feat: add PostToolUse signal detector entrypoint"
```

---

## Task 7: Hook Registrations + No-op Placeholder

**Files:**
- Create: `hooks/hooks.json`
- Create: `hooks/user-prompt-submit.js`

- [ ] **Step 1: Create hooks/hooks.json**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.js\"",
            "async": true
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-use.js\"",
            "async": false
          }
        ]
      },
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-use.js\"",
            "async": false
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/user-prompt-submit.js\"",
            "async": true
          }
        ]
      }
    ]
  }
}
```

Note: `PostToolUse` uses `async: false` so the signal is injected into Claude's context before it responds. Two separate `matcher` entries (Write + Edit) for clarity — avoids relying on regex alternation in matcher strings.

- [ ] **Step 2: Create hooks/user-prompt-submit.js**

```javascript
#!/usr/bin/env node
// hooks/user-prompt-submit.js
// v1: no-op placeholder.
// v2: set enableMessageScanning: true in config to activate keyword logging.
'use strict';
process.exit(0);
```

- [ ] **Step 3: Verify hooks.json is valid JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8')); console.log('valid')"
```

Expected: `valid`

- [ ] **Step 4: Commit**

```bash
git add hooks/hooks.json hooks/user-prompt-submit.js
git commit -m "feat: add hook registrations and no-op UserPromptSubmit placeholder"
```

---

## Task 8: CLAUDE.md Directive

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Create CLAUDE.md**

```markdown
# ADR Auto Generator

This plugin monitors file edits for architectural decision signals and captures them as ADR documents.

## Available Skills

- **adr-capture** (`skills/adr-capture/SKILL.md`): Guides the full ADR creation flow — prompts the user, extracts context, fills the Nygard template, and saves the file.

## PostToolUse Hook Directive

**This is a hard rule.** If any PostToolUse hook output contains the key `"signal":"adr-detected"`, you MUST invoke the `adr-capture` skill immediately — before composing your response to the user. Do not skip this step even if the decision seems minor or if you are in the middle of another task.

The signal has this shape:
```json
{"signal":"adr-detected","file":"path/to/file","keyword":"matched keyword","hash":"8charHex"}
```

Pass the `file`, `keyword`, and `hash` values to the skill as context when invoking it.

## What NOT to Do

- Do not summarize or paraphrase the signal to the user — invoke the skill instead.
- Do not skip the skill because you "already know" what the decision is.
- Do not invoke the skill more than once per signal (the hash dedup in the skill handles repeated signals).
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "feat: add CLAUDE.md with PostToolUse directive"
```

---

## Task 9: Skill File — skills/adr-capture/SKILL.md

**Files:**
- Create: `skills/adr-capture/SKILL.md`

- [ ] **Step 1: Create skills/adr-capture/SKILL.md**

```markdown
# adr-capture — Architectural Decision Record Capture

Invoked by CLAUDE.md directive when PostToolUse hook emits `{"signal":"adr-detected",...}`.

## Inputs

From the signal injected by the hook:
- `file` — the file path that triggered detection
- `keyword` — the matched decision keyword string
- `hash` — 8-character hex dedup key

## Step 1: Idempotency Check

Use the Read tool to read `~/.claude/adr-session-hashes.json`.
- If the file does not exist: continue to Step 2.
- If `hash` is a key in that file: **exit silently.** Do not prompt the user.

## Step 2: Prompt the User

Present exactly this message (substitute `[keyword]` and `[file]`):

> Looks like you're making an architectural decision: **[keyword]** in `[file]`.
> Want me to capture it as an ADR?
>
> Reply with **yes**, **edit first**, or **no**.

Wait for the user's reply. If the reply is unclear, ask them to choose one of the three options.

## Step 3: Handle "no"

Exit silently. Do not generate anything.

## Step 4: Extract Context ("yes" or "edit first")

Scan the last 10 messages in the conversation. Weight messages as follows:
1. Messages within 3 turns of the file edit → full weight (prioritize these)
2. Messages containing `keyword` → full weight
3. All other messages → partial weight (fill gaps only)

From this context, extract:
- **Problem / context:** What situation or constraint prompted this change?
- **Decision:** What specifically was decided?
- **Alternatives:** What other options were discussed or implied?
- **Consequences:** What trade-offs or expected outcomes were mentioned?

If you cannot determine what was decided or why (context is ambiguous), ask ONE clarifying question before continuing.

## Step 5: Determine ADR Number

Run via Bash tool:
```bash
ls <adrDir>/*.md 2>/dev/null | wc -l
```
Where `<adrDir>` is the resolved ADR directory (see Config Reading below).

ADR number = (count of .md files) + 1, zero-padded to 4 digits.
Examples: 0 existing files → `ADR-0001`. 3 existing files → `ADR-0004`.

## Step 6: Generate Title

Derive a short, active-voice title from the keyword and file context. Examples:
- keyword `replace axios with`, file `package.json` → `Replace REST Client with GraphQL`
- keyword `migrate to`, file `requirements.txt` → `Migrate Python Package Manager`
- keyword `switch from`, file `docker-compose.yml` → `Switch Container Orchestration`
- keyword `deprecating`, file `api/v1/routes.py` → `Deprecate API v1 Routes`

If no clear title can be derived: use `[Capitalized Keyword] in [basename without extension]`.

## Step 7: Get Git SHA

Run via Bash tool:
```bash
git rev-parse HEAD 2>/dev/null
```
If the command fails or output is empty: set `gitRef = null`.

## Step 8: Fill Nygard Template

Populate the template below. Omit the `**Git reference:**` line entirely if `gitRef` is null.
Keep total length 200–400 words.

```markdown
# ADR-[N]: [Title]

**Date:** [YYYY-MM-DD]
**Status:** proposed
**Git reference:** [SHA]

## Context

[2-4 sentences: the situation, problem, or constraint that prompted this decision]

## Decision

[1-3 sentences: what was decided, stated in active voice]

## Alternatives Considered

- **[Alternative 1]:** [Why not chosen, 1 sentence]
- **[Alternative 2]:** [Why not chosen, 1 sentence]

## Consequences

**Positive:**
- [Benefit]

**Negative / Trade-offs:**
- [Trade-off]
```

If no alternatives were discussed in context: write a single bullet: `- No alternatives were discussed.`

## Step 9: Present Draft

Show the filled template inline in the conversation inside a fenced markdown code block (` ```markdown `).

## Step 10: Handle "edit first" — Wait for Edits

If the user chose **edit first**:
- After presenting the draft, say: `"Reply with your edits and I'll apply them before saving."`
- Wait for the user's reply. Apply their corrections to the template.
- If no edits reply after **2 follow-up prompts**: save the draft as-is and set `**Status:** pending user review`.

If the user chose **yes**: proceed directly to Step 11.

## Step 11: Determine Save Path

Read config in this order (stop at first match):
1. Read `<cwd>/.adr-config.json` — use `adrDir` if present
2. Read `~/.claude/adr-config.json` — use `adrDir` if present
3. Default: `docs/adr`

Build the file path:
```
slug     = title.toLowerCase()
           → replace sequences of non-alphanumeric chars with hyphens
           → strip leading and trailing hyphens
filename = YYYY-MM-DD-<slug>.md   (today's date at save time)
fullPath = <cwd>/<adrDir>/<filename>
```

If `fullPath` already exists: append `-2`, `-3`, etc. to slug until the path is unique.

## Step 12: Create Directory and Save

Run via Bash tool:
```bash
mkdir -p <adrDir>
```

Write the final ADR using the Write tool to `<fullPath>`.

## Step 13: Confirm

Reply to the user:
> `ADR saved to <fullPath>`

---

## Config Reading Reference

To resolve `adrDir`, use the Read tool on `.adr-config.json` (project) and `~/.claude/adr-config.json` (global) in that order. Take the first `adrDir` value found. Default `docs/adr`.

## Edge Case Reference

| Scenario | Handling |
|----------|----------|
| No git repo (`git rev-parse` fails) | Omit `**Git reference:**` line entirely |
| `adrDir` does not exist | `mkdir -p` before writing |
| File already exists at target path | Append `-2`, `-3` to slug |
| Context is ambiguous | Ask one clarifying question, then continue |
| "edit first" — no reply after 2 prompts | Save with `**Status:** pending user review` |
| Hash already in session hashes | Exit silently (Step 1) |
| Alternatives not discussed | Single bullet: `- No alternatives were discussed.` |

---

## Example Session

**Signal received:** `{"signal":"adr-detected","file":"package.json","keyword":"replace axios with","hash":"b7e3a1"}`

**Skill prompts:**
> Looks like you're making an architectural decision: **replace axios with** in `package.json`.
> Want me to capture it as an ADR?
>
> Reply with **yes**, **edit first**, or **no**.

**User replies:** `yes`

**Skill generates:**

```markdown
# ADR-0001: Replace REST Client with GraphQL

**Date:** 2026-05-06
**Status:** proposed
**Git reference:** abc1234def56789

## Context

The dashboard page required four separate REST API calls on each load,
causing visible latency under moderate traffic. The team evaluated
consolidating data fetching to reduce round-trips and eliminate
over-fetching of unused fields.

## Decision

Replace axios-based REST calls with graphql-request targeting the new
GraphQL endpoint. Migration begins with the dashboard module and extends
to other views incrementally.

## Alternatives Considered

- **Keep REST with request batching:** Reduces round-trips but requires
  custom batching logic and does not solve over-fetching.
- **Switch to tRPC:** Provides end-to-end type safety but requires a
  full-stack refactor outside the current sprint scope.

## Consequences

**Positive:**
- Dashboard load reduces from 4 REST requests to 1 GraphQL query
- Frontend controls response shape, eliminating over-fetching

**Negative / Trade-offs:**
- Team requires GraphQL training before migration can proceed
- REST endpoints must remain active during the transition period
```

ADR saved to `docs/adr/2026-05-06-replace-rest-client-with-graphql.md`
```

- [ ] **Step 2: Verify file is valid markdown (no broken code fences)**

```bash
node -e "
const src = require('fs').readFileSync('skills/adr-capture/SKILL.md','utf8');
const opens = (src.match(/^\`\`\`/mg)||[]).length;
console.log('fence pairs:', opens, opens % 2 === 0 ? 'OK' : 'MISMATCH');
"
```

Expected: `fence pairs: N OK` (even number)

- [ ] **Step 3: Commit**

```bash
git add skills/adr-capture/SKILL.md
git commit -m "feat: add adr-capture skill with full Nygard ADR flow"
```

---

## Task 10: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README.md**

```markdown
# ADR Auto Generator (Decision Sniffer)

A Claude Code plugin that detects architectural decisions from file edits and
guides you through capturing them as [Nygard-style ADRs](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

## What it does

Whenever Claude edits an infrastructure or configuration file (e.g., `package.json`,
`Dockerfile`, `*.tf`) and the diff contains a decision keyword (e.g., "migrate to",
"replace X with"), the plugin:

1. Checks it hasn't already prompted for this decision
2. Asks: "Looks like you're making an architectural decision. Generate ADR? yes / edit first / no"
3. Extracts context from the recent conversation
4. Pre-fills a Nygard template and saves to `docs/adr/YYYY-MM-DD-<title>.md`
5. Records the current git commit SHA in the ADR

## Install

```bash
claude plugin install adr-auto-generator
```

Or manually:
```bash
# Clone this repo, then:
cp -r adr-auto-generator ~/.claude/plugins/local/adr-auto-generator
# Restart Claude Code to activate
```

## Configuration

### Global defaults — `~/.claude/adr-config.json`

```json
{
  "adrDir": "docs/adr",
  "infraPatterns": ["package.json", "docker-compose.yml", "*.tf"],
  "infraPathPrefixes": [".github/workflows/", "config/"],
  "infraNamePatterns": ["migration", "schema"],
  "decisionKeywords": [
    "migrate (from|to)",
    "replace .+ with",
    "switch (from|to)",
    "deprecat(e|ing|ed)"
  ],
  "enableMessageScanning": false
}
```

### Per-project override — `.adr-config.json` (at repo root)

Any key here **replaces** the global value (arrays are not merged).

```json
{
  "adrDir": "architecture/decisions",
  "decisionKeywords": ["migrate to", "adopt", "deprecate", "use-case-specific-signal"]
}
```

### Sensitivity tuning

| Too many false positives | Too few detections |
|--------------------------|-------------------|
| Remove patterns from `infraPatterns` | Add patterns to `infraPatterns` |
| Remove keywords from `decisionKeywords` | Add keywords to `decisionKeywords` |
| Both conditions required by design | Check `~/.claude/adr-missed-decisions.log` (v2) |

## ADR directory

Default: `docs/adr/` relative to your project root.
Override per-project via `.adr-config.json` → `"adrDir"`.

## Extending signal patterns

Edit `~/.claude/adr-config.json` to add new infra file patterns or decision keywords.
Patterns use simple glob syntax (`*.ext`) or exact filenames. Keywords are regex strings (case-insensitive).

## Running tests

```bash
npm test
# or
node --test tests/*.test.js
```

## Example output

After Claude edits `requirements.txt` with content including "migrate to peewee":

```
Looks like you're making an architectural decision: migrate to in requirements.txt.
Want me to capture it as an ADR?

Reply with yes, edit first, or no.
```

User replies `yes`:

```markdown
# ADR-0001: Migrate Python ORM

**Date:** 2026-05-06
**Status:** proposed
**Git reference:** a1b2c3d4

## Context
...
```

Saved to `docs/adr/2026-05-06-migrate-python-orm.md`

## v2 Roadmap

- Message scanning (detect decisions in chat without file changes)
- Weighted confidence scoring
- Cross-session dedup
- ADR index (`docs/adr/README.md` auto-generated)
- Status transitions (proposed → accepted → superseded)
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with install, config, and example output"
```

---

## Task 11: Full Test Suite + Smoke Test

**Files:** none created — verification only

- [ ] **Step 1: Run complete test suite**

```bash
node --test tests/*.test.js
```

Expected: all tests passing, no failures.

- [ ] **Step 2: Verify all plugin files present**

```bash
find . -not -path './.git/*' -type f | sort
```

Expected output includes:
```
./CLAUDE.md
./README.md
./hooks/adr-config.js
./hooks/detector.js
./hooks/hooks.json
./hooks/package.json
./hooks/post-tool-use.js
./hooks/session-start.js
./hooks/user-prompt-submit.js
./package.json
./skills/adr-capture/SKILL.md
./tests/adr-config.test.js
./tests/detector.test.js
./tests/post-tool-use.test.js
```

- [ ] **Step 3: Verify hooks.json is valid and contains all three event types**

```bash
node -e "
const h = JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8'));
const events = Object.keys(h.hooks);
console.log('Events:', events.join(', '));
const ptu = h.hooks.PostToolUse;
console.log('PostToolUse matchers:', ptu.map(e => e.matcher).join(', '));
"
```

Expected:
```
Events: SessionStart, PostToolUse, UserPromptSubmit
PostToolUse matchers: Write, Edit
```

- [ ] **Step 4: Manual smoke test — simulate hook input**

```bash
echo '{"tool_name":"Write","tool_input":{"file_path":"package.json","content":"replace axios with graphql-request for all data fetching"}}' \
  | CLAUDE_CONFIG_DIR=/tmp/adr-smoke-$$ node hooks/post-tool-use.js
```

Expected: JSON output like `{"signal":"adr-detected","file":"package.json","keyword":"replace axios with","hash":"XXXXXXXX"}`

- [ ] **Step 5: Run smoke test twice — verify dedup**

```bash
DIR=/tmp/adr-smoke-$$
PAYLOAD='{"tool_name":"Write","tool_input":{"file_path":"package.json","content":"replace axios with graphql-request"}}'
echo $PAYLOAD | CLAUDE_CONFIG_DIR=$DIR node hooks/post-tool-use.js  # should emit signal
echo "---"
echo $PAYLOAD | CLAUDE_CONFIG_DIR=$DIR node hooks/post-tool-use.js  # should emit nothing
rm -rf $DIR
```

Expected: first call emits `{"signal":"adr-detected",...}`, second call emits nothing.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: verified full test suite and smoke tests pass"
```
