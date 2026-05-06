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
