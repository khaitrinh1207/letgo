import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const cli = path.resolve(import.meta.dirname, '..', 'scripts', 'hub.mjs');

function fixture() {
  const hub = mkdtempSync(path.join(tmpdir(), 'letgo-hub-'));
  const plan = path.join(hub, 'plans', 'sample-feature');
  mkdirSync(path.join(plan, 'artifacts'), { recursive: true });
  for (const file of ['index.md', 'requirement.md', 'implementation-map.md', 'prod-checklist.md', 'flow.md', 'artifacts/runtime-flow.md']) {
    writeFileSync(path.join(plan, file), `# ${file}\n`);
  }
  writeFileSync(path.join(plan, 'feature.yml'), JSON.stringify({
    schemaVersion: 1,
    id: 'sample-feature',
    title: 'Sample feature',
    lifecycle: 'active',
    summary: 'Example state.',
    contextRoutes: {
      resume: ['index.md', 'implementation-map.md'],
      release: ['index.md', 'prod-checklist.md'],
    },
    repositories: [],
    deliverables: [{
      id: 'api-change',
      title: 'Expose the sample endpoint',
      changeType: 'feature',
      environments: {
        dev: { mergeState: 'merged', deploymentState: 'verified', qcState: 'passed' },
        stg: { mergeState: 'opened', deploymentState: 'pending', qcState: 'pending' },
        prod: { mergeState: 'not-required', deploymentState: 'unknown', qcState: 'unknown' },
      },
      prodChecklist: 'prod-checklist.md',
    }],
    artifacts: {
      businessFlow: 'flow.md',
      runtimeFlow: 'artifacts/runtime-flow.md',
      implementationMap: 'implementation-map.md',
    },
  }, null, 2));
  return hub;
}

function run(hub, ...args) {
  return spawnSync(process.execPath, [cli, '--hub', hub, ...args], { encoding: 'utf8' });
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

function checklist(blankSections = []) {
  const body = checklistSections
    .map((section) => `## ${section}\n\n${blankSections.includes(section) ? '' : 'N/A — nothing to do.\n'}`)
    .join('\n');
  return `# Production checklist\n\n${body}`;
}

function promoteToMaintenance(hub, { prodDeploymentState, blankSections = [] }) {
  const plan = path.join(hub, 'plans', 'sample-feature');
  const feature = JSON.parse(readFileSync(path.join(plan, 'feature.yml'), 'utf8'));
  feature.lifecycle = 'maintenance';
  feature.deliverables[0].environments.prod = {
    mergeState: 'merged',
    deploymentState: prodDeploymentState,
    qcState: 'passed',
  };
  writeFileSync(path.join(plan, 'feature.yml'), JSON.stringify(feature, null, 2));
  writeFileSync(path.join(plan, 'prod-checklist.md'), checklist(blankSections));
}

test('route returns only the files declared for the selected intent', () => {
  const hub = fixture();
  const result = run(hub, 'route', 'sample-feature', '--intent', 'release');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(result.stdout.trim().split('\n'), [
    'plans/sample-feature/index.md',
    'plans/sample-feature/prod-checklist.md',
  ]);
});

test('status keeps merge, deployment, and QC evidence separate', () => {
  const hub = fixture();
  const result = run(hub, 'status', 'sample-feature', '--json');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const status = JSON.parse(result.stdout);
  assert.equal(status.deliverables[0].environments.stg.mergeState, 'opened');
  assert.equal(status.deliverables[0].environments.stg.deploymentState, 'pending');
  assert.equal(status.deliverables[0].environments.prod.deploymentState, 'unknown');
});

test('doctor rejects bare opaque references and incomplete production checklists', () => {
  const hub = fixture();
  const plan = path.join(hub, 'plans', 'sample-feature');
  writeFileSync(path.join(plan, 'index.md'), '# Sample\n\nBlocked by D1.\n');
  writeFileSync(path.join(plan, 'prod-checklist.md'), '# Production checklist\n\n- API endpoint: pending\n');

  const result = run(hub, 'doctor');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /D1 is used in prose this document never defines/);
  assert.match(result.stderr, /missing production checklist section/);
});

test('an identifier is accepted as a trailing citation, a calendar quarter, or a term the document defines', () => {
  const hub = fixture();
  const plan = path.join(hub, 'plans', 'sample-feature');
  writeFileSync(path.join(plan, 'prod-checklist.md'), checklist());
  writeFileSync(path.join(plan, 'index.md'), [
    '# Sample',
    '',
    'The unit filter matches on departmentId (D10, D31).',
    'The picker offers Q4 2025 through Q3 2026, and the scope row reads 2026-Q3.',
    'The reason source is flattened per state — see `qa.md` Q9.',
    'The dashboard indexes cover the A1–A7 predicates.',
    'The two reports now agree on received. [Q7, Q8]',
    'The picker keeps every procedure (ACTIVE, UPDATED, INACTIVE, no',
    'reception-channel filter — D45), then sorts.',
    'D7 — the rejection legs are counted separately.',
    'Reception and processing legs stay apart because of D7.',
    '',
    '```bash',
    '# D9 → PROD, run by hand',
    'curl -d \'{"quarter": "2026-Q2"}\' https://example.test',
    '```',
    '',
  ].join('\n'));

  const result = run(hub, 'doctor');

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('doctor rejects two intents that collapse onto the same documents', () => {
  const hub = fixture();
  const plan = path.join(hub, 'plans', 'sample-feature');
  const feature = JSON.parse(readFileSync(path.join(plan, 'feature.yml'), 'utf8'));
  feature.contextRoutes.business = [...feature.contextRoutes.resume];
  writeFileSync(path.join(plan, 'feature.yml'), JSON.stringify(feature, null, 2));

  const result = run(hub, 'doctor');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /routes resume and business return the same documents/);
});

test('doctor rejects a declared artifact whose file is missing', () => {
  const hub = fixture();
  rmSync(path.join(hub, 'plans', 'sample-feature', 'artifacts', 'runtime-flow.md'));

  const result = run(hub, 'doctor');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /artifact runtimeFlow points to missing artifacts\/runtime-flow\.md/);
});

test('the bare-identifier lint covers routed documents by default and every document on request', () => {
  const hub = fixture();
  writeFileSync(path.join(hub, 'plans', 'sample-feature', 'prod-checklist.md'), checklist());
  writeFileSync(path.join(hub, 'plans', 'sample-feature', 'requirement.md'), '# Requirement\n\nSuperseded by D7.\n');

  const routed = run(hub, 'doctor');
  assert.equal(routed.status, 0, routed.stderr || routed.stdout);

  const everything = run(hub, 'doctor', '--all-documents');
  assert.equal(everything.status, 1);
  assert.match(everything.stderr, /requirement\.md: D7 is used in prose this document never defines/);
});

test('doctor refuses maintenance while PROD deployment is unproven', () => {
  const hub = fixture();
  promoteToMaintenance(hub, { prodDeploymentState: 'unknown' });

  const result = run(hub, 'doctor');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /maintenance requires confirmed or verified PROD deployment/);
});

test('doctor refuses maintenance while a production checklist section is blank', () => {
  const hub = fixture();
  promoteToMaintenance(hub, { prodDeploymentState: 'verified', blankSections: ['Indexes'] });

  const result = run(hub, 'doctor');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /blank production checklist section: Indexes/);
});

test('doctor accepts maintenance backed by verified PROD deployment and a completed checklist', () => {
  const hub = fixture();
  promoteToMaintenance(hub, { prodDeploymentState: 'confirmed' });

  const result = run(hub, 'doctor');

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('snapshot stores content outside the hub and writes only a manifest inside it', () => {
  const hub = fixture();
  const cache = mkdtempSync(path.join(tmpdir(), 'letgo-cache-'));
  const result = run(hub, 'snapshot', 'create', '--cache', cache);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const manifestPath = result.stdout.trim();
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.files.some((entry) => entry.path === 'sample-feature/index.md'), true);
  assert.equal(manifest.snapshotRoot.startsWith(cache), true);
  assert.equal(manifest.snapshotRoot.startsWith(hub), false);
});

