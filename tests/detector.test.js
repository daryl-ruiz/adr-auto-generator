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
    'app.py', 'main.py', 'index.ts', 'server.js',
  ],
  infraPathPrefixes: ['.github/workflows/', 'config/'],
  infraNamePatterns: ['migration', 'schema'],
  infraContentPatterns: [
    'import\\s+asyncpg',
    'from\\s+sqlalchemy\\s+import',
    'import\\s+redis',
    'import\\s+celery',
    'from\\s+pydantic\\s+import',
  ],
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

  it('matches entry-point app.py via infraPatterns', () => {
    assert.ok(isInfraFile('src/app.py', INFRA_CONFIG));
  });

  it('matches entry-point main.py via infraPatterns', () => {
    assert.ok(isInfraFile('main.py', INFRA_CONFIG));
  });

  it('matches entry-point index.ts via infraPatterns', () => {
    assert.ok(isInfraFile('src/index.ts', INFRA_CONFIG));
  });

  it('matches entry-point server.js via infraPatterns', () => {
    assert.ok(isInfraFile('backend/server.js', INFRA_CONFIG));
  });

  it('promotes plain source file to infra when diff imports asyncpg', () => {
    assert.ok(
      isInfraFile('src/db_helpers.py', INFRA_CONFIG, 'import asyncpg\nasync def q():')
    );
  });

  it('promotes plain source file to infra when diff imports sqlalchemy', () => {
    assert.ok(
      isInfraFile('src/repo.py', INFRA_CONFIG, 'from sqlalchemy import select')
    );
  });

  it('promotes plain source file to infra when diff imports celery', () => {
    assert.ok(
      isInfraFile('worker.py', INFRA_CONFIG, 'import celery\napp = celery.Celery()')
    );
  });

  it('does not promote plain source file when diff has no heavy imports', () => {
    assert.ok(
      !isInfraFile('src/util.py', INFRA_CONFIG, 'def add(a, b):\n    return a + b')
    );
  });

  it('isInfraFile is backward compatible without diffText', () => {
    assert.ok(isInfraFile('package.json', INFRA_CONFIG));
    assert.ok(!isInfraFile('src/util.py', INFRA_CONFIG));
  });
});

describe('isInAdrDir', () => {
  let isInAdrDir;
  beforeEach(() => {
    delete require.cache[require.resolve('../hooks/detector')];
    ({ isInAdrDir } = require('../hooks/detector'));
  });

  it('returns true for relative path inside default adrDir', () => {
    assert.ok(isInAdrDir('docs/adr/0001-foo.md', {}, '/repo'));
  });

  it('returns true for absolute path inside default adrDir', () => {
    assert.ok(isInAdrDir('/repo/docs/adr/0001-foo.md', {}, '/repo'));
  });

  it('returns true for nested subdirectory', () => {
    assert.ok(isInAdrDir('docs/adr/legacy/0001.md', {}, '/repo'));
  });

  it('returns false for sibling directory', () => {
    assert.ok(!isInAdrDir('docs/api/0001-foo.md', {}, '/repo'));
  });

  it('honors custom adrDir from config', () => {
    const config = { adrDir: 'architecture/decisions' };
    assert.ok(isInAdrDir('architecture/decisions/0001.md', config, '/repo'));
    assert.ok(!isInAdrDir('docs/adr/0001.md', config, '/repo'));
  });

  it('handles trailing slash in adrDir config', () => {
    const config = { adrDir: 'architecture/decisions/' };
    assert.ok(isInAdrDir('architecture/decisions/0001.md', config, '/repo'));
  });

  it('handles Windows-style backslash paths', () => {
    assert.ok(isInAdrDir('docs\\adr\\0001-foo.md', {}, '/repo'));
  });

  it('does not match a path that merely starts with adrDir as a substring', () => {
    // 'docs/adrSomething' must not match 'docs/adr'
    assert.ok(!isInAdrDir('docs/adrSomething/x.md', {}, '/repo'));
  });
});

describe('isInfraFile excludes adrDir', () => {
  let isInfraFile;
  beforeEach(() => {
    delete require.cache[require.resolve('../hooks/detector')];
    ({ isInfraFile } = require('../hooks/detector'));
  });

  it('returns false for a markdown file inside docs/adr even if filename matches infraNamePatterns', () => {
    const config = {
      ...INFRA_CONFIG,
      adrDir: 'docs/adr',
      infraNamePatterns: ['migrate', 'migration', 'schema'],
    };
    // The filename contains "migrate" which would normally match infraNamePatterns
    // but the file is inside the configured adrDir → must be excluded.
    assert.ok(
      !isInfraFile('docs/adr/2026-05-07-migrate-from-axios.md', config, '', '/repo')
    );
  });

  it('returns false for ADR file even when content has heavy import strings', () => {
    const config = { ...INFRA_CONFIG, adrDir: 'docs/adr' };
    assert.ok(
      !isInfraFile(
        'docs/adr/0001-adopt-asyncpg.md',
        config,
        'We will import asyncpg in the data layer.',
        '/repo'
      )
    );
  });

  it('still returns true for sibling docs files outside adrDir', () => {
    const config = { ...INFRA_CONFIG, adrDir: 'docs/adr' };
    assert.ok(isInfraFile('package.json', config, '', '/repo'));
  });
});

describe('matchesInfraContent', () => {
  let matchesInfraContent;
  beforeEach(() => {
    delete require.cache[require.resolve('../hooks/detector')];
    ({ matchesInfraContent } = require('../hooks/detector'));
  });

  it('returns true for "import asyncpg"', () => {
    assert.ok(matchesInfraContent('import asyncpg', INFRA_CONFIG));
  });

  it('returns true for "from sqlalchemy import select"', () => {
    assert.ok(matchesInfraContent('from sqlalchemy import select', INFRA_CONFIG));
  });

  it('returns true for "import redis"', () => {
    assert.ok(matchesInfraContent('import redis as r', INFRA_CONFIG));
  });

  it('returns true for "from pydantic import BaseModel"', () => {
    assert.ok(matchesInfraContent('from pydantic import BaseModel', INFRA_CONFIG));
  });

  it('returns false on empty diffText', () => {
    assert.ok(!matchesInfraContent('', INFRA_CONFIG));
  });

  it('returns false when no heavy import present', () => {
    assert.ok(!matchesInfraContent('print("hello")', INFRA_CONFIG));
  });

  it('returns false when config has no infraContentPatterns', () => {
    assert.ok(!matchesInfraContent('import asyncpg', { decisionKeywords: [] }));
  });

  it('is case-insensitive', () => {
    assert.ok(matchesInfraContent('IMPORT ASYNCPG', INFRA_CONFIG));
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
