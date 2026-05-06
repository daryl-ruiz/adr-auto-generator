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
