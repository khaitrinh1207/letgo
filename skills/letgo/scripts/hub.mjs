#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const positional = args.filter((entry, index) => !entry.startsWith('--') && (index === 0 || !args[index - 1].startsWith('--')));
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultHub = path.basename(path.resolve(scriptDir, '..')) === '.agents'
  ? path.resolve(scriptDir, '..')
  : path.resolve(process.cwd(), '.agents');
const hub = path.resolve(option('--hub') ?? defaultHub);
const plansDir = path.join(hub, 'plans');
const lintEveryDocument = args.includes('--all-documents');
const command = positional[0];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function readJsonYaml(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} must use the dependency-free JSON-compatible YAML form: ${error.message}`);
  }
}

const featurePath = (slug) => path.join(plansDir, slug, 'feature.yml');

function readFeature(slug) {
  const file = featurePath(slug);
  if (!existsSync(file)) throw new Error(`Feature manifest not found: plans/${slug}/feature.yml`);
  return readJsonYaml(file);
}

function featureSlugs() {
  if (!existsSync(plansDir)) return [];
  return readdirSync(plansDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_') && existsSync(featurePath(entry.name)))
    .map((entry) => entry.name)
    .sort();
}

function route(slug) {
  const intent = option('--intent');
  if (!intent) throw new Error('route requires --intent <resume|business|implementation|release|operations>');
  const files = readFeature(slug).contextRoutes?.[intent];
  if (!Array.isArray(files)) throw new Error(`Unknown or undeclared context intent: ${intent}`);
  for (const file of files) console.log(`plans/${slug}/${file}`);
}

function status(slug) {
  const feature = readFeature(slug);
  if (args.includes('--json')) {
    console.log(JSON.stringify(feature, null, 2));
    return;
  }
  console.log(`${feature.title} [${feature.lifecycle}]`);
  console.log(feature.summary);
  for (const deliverable of feature.deliverables ?? []) {
    console.log(`\n${deliverable.id} — ${deliverable.title}`);
    for (const environment of ['dev', 'stg', 'prod']) {
      const state = deliverable.environments?.[environment] ?? {};
      console.log(`  ${environment.toUpperCase()}: merge=${state.mergeState ?? 'unknown'} deploy=${state.deploymentState ?? 'unknown'} qc=${state.qcState ?? 'unknown'}`);
    }
  }
}

const checklistSections = [
  'Delivery surfaces',
  'Access and edge configuration',
  'Data model changes',
  'Indexes',
  'Backfill and data repair',
  'Configuration and resources',
  'Deployment order and dependencies',
  'Validation and QC',
  'Rollback',
];

const provenProdDeploymentStates = ['confirmed', 'verified'];

function blankChecklistSections(content) {
  const bodies = new Map();
  let current = null;
  for (const line of content.split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1];
      bodies.set(current, []);
      continue;
    }
    if (current) bodies.get(current).push(line);
  }
  return checklistSections.filter((section) => (bodies.get(section) ?? []).every((line) => line.trim() === ''));
}

function validateFeature(slug, errors) {
  let feature;
  try {
    feature = readFeature(slug);
  } catch (error) {
    errors.push(error.message);
    return;
  }
  if (feature.schemaVersion !== 1) errors.push(`${slug}: schemaVersion must be 1`);
  if (feature.id !== slug) errors.push(`${slug}: id must match its folder name`);
  if (!['active', 'maintenance', 'superseded'].includes(feature.lifecycle)) errors.push(`${slug}: invalid lifecycle ${feature.lifecycle}`);
  const routeSignatures = new Map();
  for (const [intent, files] of Object.entries(feature.contextRoutes ?? {})) {
    if (!Array.isArray(files)) {
      errors.push(`${slug}: context route ${intent} must be an array`);
      continue;
    }
    for (const file of files) if (!existsSync(path.join(plansDir, slug, file))) errors.push(`${slug}: route ${intent} points to missing ${file}`);
    const signature = [...files].sort().join('|');
    const twin = routeSignatures.get(signature);
    if (twin) errors.push(`${slug}: routes ${twin} and ${intent} return the same documents, so neither answers its own question`);
    else routeSignatures.set(signature, intent);
  }
  for (const deliverable of feature.deliverables ?? []) {
    if (!deliverable.id || !deliverable.title) errors.push(`${slug}: every deliverable needs a descriptive id and title`);
    for (const environment of ['dev', 'stg', 'prod']) {
      const state = deliverable.environments?.[environment];
      if (!state) errors.push(`${slug}/${deliverable.id}: missing ${environment} environment state`);
      if (state && !state.mergeState) errors.push(`${slug}/${deliverable.id}: ${environment}.mergeState is required`);
      if (state && !state.deploymentState) errors.push(`${slug}/${deliverable.id}: ${environment}.deploymentState is required`);
      if (state && !state.qcState) errors.push(`${slug}/${deliverable.id}: ${environment}.qcState is required`);
    }
    const checklist = path.join(plansDir, slug, deliverable.prodChecklist ?? '');
    if (!existsSync(checklist)) errors.push(`${slug}/${deliverable.id}: production checklist is missing`);
    else {
      const content = readFileSync(checklist, 'utf8');
      for (const section of checklistSections) if (!content.includes(`## ${section}`)) errors.push(`${slug}: missing production checklist section: ${section}`);
      if (feature.lifecycle === 'maintenance') {
        for (const section of blankChecklistSections(content)) errors.push(`${slug}/${deliverable.id}: blank production checklist section: ${section}`);
      }
    }
    if (feature.lifecycle === 'maintenance' && !provenProdDeploymentStates.includes(deliverable.environments?.prod?.deploymentState)) {
      errors.push(`${slug}/${deliverable.id}: maintenance requires confirmed or verified PROD deployment`);
    }
  }
  for (const [name, file] of Object.entries(feature.artifacts ?? {})) {
    if (!existsSync(path.join(plansDir, slug, file))) errors.push(`${slug}: artifact ${name} points to missing ${file}`);
  }
  for (const file of identifierLintFiles(slug, feature)) {
    for (const identifier of unresolvableIdentifiers(readFileSync(file, 'utf8'))) {
      errors.push(`${path.relative(hub, file)}: ${identifier} is used in prose this document never defines; write "${identifier} — description" here or cite it parenthetically`);
    }
  }
}

const identifierInProse = /\b([ADIQ]\d+)\b(?!\s*(?:—|–|-|:))/g;
const identifierAnywhere = /[ADIQ]\d+/;

// An identifier is a trace key, not content: it is fine as a trailing citation or when the reading
// agent can resolve it inside the same document, and wrong when prose leans on it to carry meaning.
function unresolvableIdentifiers(content) {
  const defined = new Set([...content.matchAll(/\b([ADIQ]\d+)\b\s*(?:—|–|-|:)/g)].map((match) => match[1]));
  const prose = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\b(?:19|20)\d{2}\s*-\s*[Qq][1-4]\b/g, ' ')
    .replace(/\b[Qq][1-4]\s*[/ ]\s*(?:19|20)\d{2}\b/g, ' ')
    .replace(/\b[ADIQ]\d+\s*[—–-]\s*[ADIQ]\d+\b/g, ' ')
    .replace(/\([^()]{0,400}\)/g, (span) => (identifierAnywhere.test(span) ? ' ' : span))
    .replace(/\[[^\][]{0,400}\]/g, (span) => (identifierAnywhere.test(span) ? ' ' : span))
    .replace(/`?\b[\w.-]+\.md\b`?[^\n]{0,16}?\b[ADIQ]\d+\b/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
  return [...new Set([...prose.matchAll(identifierInProse)].map((match) => match[1]))].filter((identifier) => !defined.has(identifier));
}

function identifierLintFiles(slug, feature) {
  const featureDir = path.join(plansDir, slug);
  if (!lintEveryDocument) {
    return [...new Set(Object.values(feature.contextRoutes ?? {}).flat())]
      .filter((file) => file.endsWith('.md'))
      .map((file) => path.join(featureDir, file))
      .filter((file) => existsSync(file));
  }
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'archive') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) found.push(full);
    }
  };
  walk(featureDir);
  return found;
}

function doctor() {
  const errors = [];
  const slugs = featureSlugs();
  // A freshly scaffolded hub has no features yet. That is a valid hub, not a failure — failing here
  // would make the first command the scaffold tells a new user to run look like a broken install.
  if (slugs.length === 0) {
    console.log('Hub doctor passed: no features yet. Add one at plans/<feature>/feature.yml — see plans/_templates/.');
    return;
  }
  for (const slug of slugs) validateFeature(slug, errors);
  if (errors.length) {
    for (const error of [...new Set(errors)]) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Hub doctor passed: ${slugs.length} feature(s)`);
}

function fileInventory(root) {
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const content = readFileSync(full);
        files.push({ path: path.relative(root, full), bytes: statSync(full).size, sha256: createHash('sha256').update(content).digest('hex') });
      }
    }
  }
  walk(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function snapshotCreate() {
  const cache = path.resolve(option('--cache') ?? path.join(process.env.HOME, '.cache', 'letgo'));
  const projectId = path.basename(path.dirname(hub));
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotRoot = path.join(cache, projectId, 'snapshots', timestamp, 'plans');
  mkdirSync(path.dirname(snapshotRoot), { recursive: true });
  cpSync(plansDir, snapshotRoot, { recursive: true });
  const manifest = { schemaVersion: 1, projectId, createdAt: new Date().toISOString(), snapshotRoot, files: fileInventory(snapshotRoot) };
  const manifestDir = path.join(plansDir, '_snapshots');
  mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, `${timestamp}.json`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(manifestPath);
}

function snapshotDiff() {
  const manifestPath = option('--manifest');
  if (!manifestPath) throw new Error('snapshot diff requires --manifest <path>');
  const manifest = JSON.parse(readFileSync(path.resolve(manifestPath), 'utf8'));
  const before = new Map(manifest.files.map((entry) => [entry.path, entry.sha256]));
  const after = new Map(fileInventory(plansDir).filter((entry) => !entry.path.startsWith('_snapshots/')).map((entry) => [entry.path, entry.sha256]));
  console.log(JSON.stringify({
    added: [...after.keys()].filter((file) => !before.has(file)),
    removed: [...before.keys()].filter((file) => !after.has(file)),
    changed: [...after.keys()].filter((file) => before.has(file) && before.get(file) !== after.get(file)),
  }, null, 2));
}

function registryContent() {
  const rows = featureSlugs().map((slug) => {
    const feature = readFeature(slug);
    const summary = feature.summary.replace(/\|/g, '\\|').slice(0, 180);
    const environments = ['dev', 'stg', 'prod'].map((environment) => {
      const states = (feature.deliverables ?? []).map((item) => item.environments?.[environment]?.deploymentState ?? 'unknown');
      if (!states.length || states.includes('unknown')) return 'unknown';
      if (states.every((state) => ['verified', 'confirmed', 'not-required'].includes(state))) return 'ready';
      return 'pending';
    });
    const entry = feature.contextRoutes?.resume?.[0] ?? 'index.md';
    return `| [${slug}](${slug}/${entry}) | ${feature.lifecycle} | ${environments[0]} | ${environments[1]} | ${environments[2]} | ${summary} |`;
  });
  return `# Plans registry\n\nGenerated from each feature's \`feature.yml\`. Do not maintain delivery details here.\n\n| Plan | Lifecycle | DEV | STG | PROD | Summary |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
}

function registry(action) {
  const target = path.join(plansDir, '_REGISTRY.md');
  const expected = registryContent();
  if (action === 'render') {
    writeFileSync(target, expected);
    console.log(target);
  } else if (action === 'check') {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== expected) fail('plans/_REGISTRY.md is stale; run registry render');
    else console.log('Plans registry is current.');
  } else throw new Error('registry requires render or check');
}

function compare(slug) {
  const feature = readFeature(slug);
  const configPath = path.join(hub, '_config', 'project.json');
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
  const workspace = path.resolve(hub, '..');
  const results = [];
  for (const repository of feature.repositories ?? []) {
    const configured = (config.repositories ?? []).find((entry) => entry.id === repository.id);
    const repoPath = path.resolve(workspace, configured?.path ?? repository.path ?? repository.id);
    if (!repository.documentedRevision || repository.documentedRevision === 'unknown') {
      results.push({ repository: repository.id, state: 'unknown', reason: 'documentedRevision is unknown' });
      continue;
    }
    const git = spawnSync('git', ['-C', repoPath, 'diff', '--name-only', repository.documentedRevision, 'HEAD', '--', ...(repository.scopedPaths ?? [])], { encoding: 'utf8' });
    if (git.status !== 0) results.push({ repository: repository.id, state: 'unknown', reason: git.stderr.trim() });
    else {
      const changedPaths = git.stdout.trim().split('\n').filter(Boolean);
      results.push({ repository: repository.id, state: changedPaths.length ? 'review-required' : 'current', changedPaths });
    }
  }
  console.log(JSON.stringify(results, null, 2));
}

try {
  if (command === 'route') route(positional[1]);
  else if (command === 'status') status(positional[1]);
  else if (command === 'doctor') doctor();
  else if (command === 'snapshot' && positional[1] === 'create') snapshotCreate();
  else if (command === 'snapshot' && positional[1] === 'diff') snapshotDiff();
  else if (command === 'registry') registry(positional[1]);
  else if (command === 'compare') compare(positional[1]);
  else throw new Error('Usage: hub.mjs [--hub PATH] <route|status|doctor|snapshot|registry|compare> ...');
} catch (error) {
  fail(error.message);
}
