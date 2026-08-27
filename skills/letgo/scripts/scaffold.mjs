#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.resolve(scriptDir, '..', 'templates');
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const workspace = path.resolve(option('--workspace') ?? process.cwd());
const hub = path.resolve(option('--hub') ?? path.join(workspace, '.agents'));
const project = option('--project') ?? path.basename(workspace);
const repos = (option('--repos') ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
const today = new Date().toISOString().slice(0, 10);

if (hub === workspace) {
  console.error('--hub must identify the .agents data hub, not the workspace root');
  process.exit(1);
}

function render(relativePath, replacements = {}) {
  let content = readFileSync(path.join(templatesDir, relativePath), 'utf8');
  const values = {
    PROJECT_NAME: project,
    DATE: today,
    REPOS_LIST: repos.length ? repos.map((repo) => `- \`${repo}\``).join('\n') : '- (register repository roots here)',
    CHILD_INSTRUCTIONS: repos.length ? repos.map((repo) => `- [\`${repo}/AGENTS.md\`](./${repo}/AGENTS.md) — ${repo} instructions.`).join('\n') : '- (register repository instruction files here)',
    REPOS_JSON: repos.map((repo) => `\n    {"id": "${repo}", "path": "${repo}", "scopedPaths": []}`).join(',') + (repos.length ? '\n  ' : ''),
    ...replacements,
  };
  for (const [key, value] of Object.entries(values)) content = content.replaceAll(`{{${key}}}`, value);
  return content;
}

function writeIfMissing(root, relativePath, content) {
  const target = path.join(root, relativePath);
  const display = path.relative(workspace, target) || relativePath;
  if (existsSync(target)) {
    console.log(`[skip ] ${display} (exists)`);
    return 0;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.log(`[write] ${display}`);
  return 1;
}

function copyScriptIfMissing(scriptName, targetPath) {
  return writeIfMissing(hub, targetPath, readFileSync(path.join(scriptDir, scriptName), 'utf8'));
}

// Runtimes disagree on which filename they auto-load: Codex, OpenCode and Cursor read AGENTS.md,
// Claude Code reads CLAUDE.md. Without an entry file of its own, a scaffolded hub is invisible to
// Claude Code. A one-line pointer rather than a symlink, because symlinks need elevation on Windows.
const runtimeEntryAliases = { claude: 'CLAUDE.md' };
const entryPointer = '# Instructions\n\nFollow [`AGENTS.md`](./AGENTS.md) in this directory. It is the single instruction source here;\nnothing is duplicated into this file.\n';

function ensureEntryAliases(root) {
  const targets = JSON.parse(render('_config/agents.json')).targets ?? {};
  let written = 0;
  for (const [runtime, enabled] of Object.entries(targets)) {
    const alias = runtimeEntryAliases[runtime];
    if (enabled && alias) written += writeIfMissing(root, alias, entryPointer);
  }
  return written;
}

function ensureRepoHubLink(repo) {
  const repoRoot = path.join(workspace, repo);
  if (!existsSync(repoRoot)) return;
  const link = path.join(repoRoot, '.agents');
  if (existsSync(link)) return;
  const relativeTarget = path.relative(repoRoot, hub);
  symlinkSync(relativeTarget, link);
  console.log(`[link ] ${repo}/.agents -> ${relativeTarget}`);
}

mkdirSync(hub, { recursive: true });
let created = 0;
created += writeIfMissing(workspace, 'AGENTS.md', render('AGENTS.md.tmpl'));
created += writeIfMissing(hub, 'README.md', render('hub-README.md.tmpl'));
created += writeIfMissing(hub, 'plans/_INSTRUCTION.md', render('plans/_INSTRUCTION.md'));
created += writeIfMissing(hub, 'plans/_SCHEMA.md', render('plans/_SCHEMA.md'));
created += writeIfMissing(hub, 'plans/_REGISTRY.md', render('plans/_REGISTRY.md'));
created += writeIfMissing(hub, 'plans/_templates/feature.yml', render('plans/feature.yml'));
created += writeIfMissing(hub, 'plans/_templates/prod-checklist.md', render('plans/prod-checklist.md'));
created += writeIfMissing(hub, 'plans/_templates/current-context.md', render('plans/current-context.md'));
created += copyScriptIfMissing('lint-plans.mjs', 'plans/_tools/lint-plans.mjs');
created += copyScriptIfMissing('graph.mjs', '_tools/graph.mjs');
created += copyScriptIfMissing('hub.mjs', '_tools/hub.mjs');
created += copyScriptIfMissing('sync-agents.mjs', '_tools/sync-agents.mjs');
created += writeIfMissing(hub, 'memories/README.md', render('memories/README.md'));
created += writeIfMissing(hub, 'docs/registry.yml', render('docs/registry.yml'));
created += writeIfMissing(hub, 'docs/adapters/README.md', render('docs/adapters/README.md'));
created += writeIfMissing(hub, 'environments/README.md', render('environments/README.md'));
created += writeIfMissing(hub, 'scripts/README.md', render('scripts/README.md'));
created += writeIfMissing(hub, '_config/project.json', render('_config/project.json'));
created += writeIfMissing(hub, '_config/agents.json', render('_config/agents.json'));

created += ensureEntryAliases(workspace);

for (const repo of repos) {
  created += writeIfMissing(hub, `context/${repo}/README.md`, render('context-repo.md.tmpl', { REPO_NAME: repo }));
  ensureRepoHubLink(repo);
  const repoRoot = path.join(workspace, repo);
  if (!existsSync(repoRoot)) continue;
  created += writeIfMissing(repoRoot, 'AGENTS.md', render('repo-AGENTS.md.tmpl', { REPO_NAME: repo }));
  created += ensureEntryAliases(repoRoot);
}
for (const directory of ['skills', 'plans', 'context']) mkdirSync(path.join(hub, directory), { recursive: true });

console.log(`\nScaffold complete: ${created} file(s) created`);
console.log(`Workspace: ${workspace}`);
console.log(`Hub: ${hub}`);
console.log(`Verify: node ${path.join(hub, '_tools', 'hub.mjs')} doctor`);

