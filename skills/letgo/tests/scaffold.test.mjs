import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const skillRoot = path.resolve(import.meta.dirname, '..');
const scaffold = path.join(skillRoot, 'scripts', 'scaffold.mjs');

function runScaffold(workspace, extra = []) {
  return spawnSync(process.execPath, [
    scaffold,
    '--workspace', workspace,
    '--hub', path.join(workspace, '.agents'),
    '--project', 'ShopFlow',
    '--repos', 'api,web',
    ...extra,
  ], { encoding: 'utf8' });
}

test('scaffold separates workspace instructions from the shared agent hub', () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'letgo-scaffold-'));
  const result = runScaffold(workspace);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8').includes('ShopFlow'), true);
  assert.equal(readFileSync(path.join(workspace, '.agents', 'README.md'), 'utf8').includes('agent-only'), true);
  assert.equal(readFileSync(path.join(workspace, '.agents', 'context', 'api', 'README.md'), 'utf8').includes('api'), true);
  assert.equal(readFileSync(path.join(workspace, '.agents', 'context', 'web', 'README.md'), 'utf8').includes('web'), true);
  assert.equal(readFileSync(path.join(workspace, '.agents', 'docs', 'registry.yml'), 'utf8').includes('provider'), true);
  assert.equal(readFileSync(path.join(workspace, '.agents', 'environments', 'README.md'), 'utf8').includes('DEV'), true);
  assert.equal(readFileSync(path.join(workspace, '.agents', 'scripts', 'README.md'), 'utf8').includes('project-specific'), true);
  assert.equal(readFileSync(path.join(workspace, '.agents', '_config', 'project.json'), 'utf8').includes('workspace'), true);
  assert.throws(() => readFileSync(path.join(workspace, '.agents', 'AGENTS.md')));
  assert.throws(() => readFileSync(path.join(workspace, '.agents', 'onboarding', 'api', 'README.md')));
});

test('scaffold is idempotent and preserves existing workspace instructions', () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'letgo-idempotent-'));
  assert.equal(runScaffold(workspace).status, 0);
  const agentsPath = path.join(workspace, 'AGENTS.md');
  writeFileSync(agentsPath, `${readFileSync(agentsPath, 'utf8')}\nHuman-owned addition.\n`);

  const rerun = runScaffold(workspace);

  assert.equal(rerun.status, 0, rerun.stderr || rerun.stdout);
  assert.match(readFileSync(agentsPath, 'utf8'), /Human-owned addition\./);
  assert.match(rerun.stdout, /\[skip \] AGENTS\.md/);
});

