#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const dryRun = flag('--dry-run');
const force = flag('--force');
const onlyTarget = option('--to');
const explicitRoot = option('--root');
const explicitHub = option('--hub');

function findConfig() {
  if (explicitHub) {
    const candidate = path.resolve(explicitHub, '_config', 'agents.json');
    if (!existsSync(candidate)) fail(`No agents.json at ${candidate}`, 1);
    return candidate;
  }
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, '.agents', '_config', 'agents.json');
    if (existsSync(candidate)) return realpathSync(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) fail('No .agents/_config/agents.json found from cwd upward. Run inside a project with a hub, or pass --hub.', 1);
    dir = parent;
  }
}

function fail(message, code) {
  console.error(`sync-agents: ${message}`);
  process.exit(code);
}

function interpolateEnv(value) {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => {
    if (!(name in process.env)) fail(`Environment variable ${name} is not set; refusing to sync.`, 1);
    return process.env[name];
  });
}

function deepInterpolate(value) {
  if (typeof value === 'string') return interpolateEnv(value);
  if (Array.isArray(value)) return value.map(deepInterpolate);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepInterpolate(item)]));
  }
  return value;
}

function deepOpenCodeTemplates(value) {
  if (typeof value === 'string') return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, '{env:$1}');
  if (Array.isArray(value)) return value.map(deepOpenCodeTemplates);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepOpenCodeTemplates(item)]));
  }
  return value;
}

function loadConfig(configPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    fail(`Cannot parse ${configPath}: ${error.message}`, 1);
  }
  if (parsed.version !== 1) fail(`${configPath} version must be 1`, 1);
  if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') fail(`${configPath} missing mcpServers object`, 1);
  for (const [name, server] of Object.entries(parsed.mcpServers)) {
    if (server.type === 'stdio' && !server.command) fail(`mcpServers.${name}: stdio requires command`, 1);
    if ((server.type === 'http' || server.type === 'sse') && !server.url) fail(`mcpServers.${name}: ${server.type} requires url`, 1);
  }
  return parsed;
}

function tomlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function tomlInlineTable(record) {
  const entries = Object.entries(record).map(([key, value]) => `${key} = ${tomlString(value)}`);
  return `{ ${entries.join(', ')} }`;
}

function codexServerBlock(name, server) {
  const lines = [`[mcp_servers.${name}]`];
  if (server.type === 'stdio') {
    lines.push(`command = ${tomlString(server.command)}`);
    if (server.args?.length) lines.push(`args = [${server.args.map(tomlString).join(', ')}]`);
    if (server.env && Object.keys(server.env).length > 0) lines.push(`env = ${tomlInlineTable(server.env)}`);
  } else {
    lines.push(`url = ${tomlString(server.url)}`);
  }
  lines.push('');
  return `${lines.join('\n')}`;
}

function replaceManagedTomlSections(content, blocks) {
  const lines = content.split(/\r?\n/);
  const kept = [];
  const removed = [];
  let inManaged = false;
  for (const line of lines) {
    if (/^\[mcp_servers\.[^\]]+\]\s*$/.test(line.trim())) {
      inManaged = true;
      removed.push(line);
      continue;
    }
    if (inManaged) {
      if (/^\[[^\]]+\]\s*$/.test(line.trim())) {
        inManaged = false;
        kept.push(line);
        continue;
      }
      removed.push(line);
      continue;
    }
    kept.push(line);
  }
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  const base = kept.length > 0 ? `${kept.join('\n')}\n\n` : '';
  return { before: removed.join('\n').trim(), after: `${base}${blocks.join('\n')}`.trim() };
}

function jsonManagedUpdate(filePath, rootKey, generated) {
  let current = {};
  if (existsSync(filePath)) {
    try {
      current = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (error) {
      fail(`Cannot parse existing ${filePath}: ${error.message}`, 1);
    }
  }
  const before = JSON.stringify(current[rootKey] ?? null);
  const after = JSON.stringify(generated);
  return { current, before, after, equal: before === after };
}

function opencodeEntry(server) {
  if (server.type === 'stdio') {
    const entry = { type: 'local', command: [server.command, ...(server.args ?? [])] };
    if (server.env && Object.keys(server.env).length > 0) entry.environment = server.env;
    if (server.enabled !== undefined) entry.enabled = server.enabled;
    return entry;
  }
  const entry = { type: 'remote', url: server.url };
  if (server.headers && Object.keys(server.headers).length > 0) entry.headers = server.headers;
  if (server.enabled !== undefined) entry.enabled = server.enabled;
  return entry;
}

function claudeCursorEntry(server) {
  if (server.type === 'stdio') {
    const entry = { type: server.type, command: server.command };
    if (server.args?.length) entry.args = server.args;
    if (server.env && Object.keys(server.env).length > 0) entry.env = server.env;
    return entry;
  }
  const entry = { type: server.type, url: server.url };
  if (server.headers && Object.keys(server.headers).length > 0) entry.headers = server.headers;
  return entry;
}

function planJsonTarget(label, filePath, rootKey, servers, convert) {
  const converted = Object.fromEntries(Object.entries(servers).map(([name, server]) => [name, convert(server)]));
  const { current, before, after, equal } = jsonManagedUpdate(filePath, rootKey, converted);
  if (equal) return { label, status: 'noop', detail: filePath };
  if (existsSync(filePath) && before !== 'null' && !dryRun && !force) {
    return { label, status: 'drift', detail: `${filePath}\n    expected: ${after}\n    found:    ${before}` };
  }
  return { label, status: dryRun ? 'planned' : 'written', apply: () => {
    current[rootKey] = JSON.parse(after);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(current, null, 2)}\n`);
  }, detail: filePath };
}

function planCodexTarget(label, filePath, servers) {
  const blocks = Object.entries(servers).map(([name, server]) => codexServerBlock(name, server));
  let existing = '';
  if (existsSync(filePath)) existing = readFileSync(filePath, 'utf8');
  const { before, after } = replaceManagedTomlSections(existing, blocks);
  if (before === after || (before === '' && !existsSync(filePath) && after === '')) {
    return { label, status: 'noop', detail: filePath };
  }
  if (existing !== '' && before !== '' && before !== after && !dryRun && !force) {
    return { label, status: 'drift', detail: `${filePath}\n    managed section differs from canonical config (use --force)` };
  }
  return { label, status: dryRun ? 'planned' : 'written', apply: () => {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${after}\n`);
  }, detail: filePath };
}

const configPath = findConfig();
const rawConfig = loadConfig(configPath);
const hubRoot = path.dirname(path.dirname(path.dirname(configPath)));
const repoRoots = (rawConfig.repos?.length ? rawConfig.repos : ['.']).map((entry) =>
  path.resolve(explicitRoot ?? hubRoot, entry),
);

const interpolatedServers = deepInterpolate(rawConfig.mcpServers);
const openCodeServers = deepOpenCodeTemplates(rawConfig.mcpServers);

const targetFilters = new Set(
  (onlyTarget ? onlyTarget.split(',').map((entry) => entry.trim()) : []).filter(Boolean),
);
const enabledTargets = Object.entries(rawConfig.targets ?? {})
  .filter(([, enabled]) => Boolean(enabled))
  .map(([name]) => name)
  .filter((name) => (targetFilters.size > 0 ? targetFilters.has(name) : true));
const unknownTargets = [...targetFilters].filter((name) => !(name in (rawConfig.targets ?? {})));
if (unknownTargets.length > 0) fail(`Unknown target(s): ${unknownTargets.join(', ')}. Known: claude, cursor, codex, opencode.`, 1);

const plans = [];
for (const root of repoRoots) {
  const servers = interpolatedServers;
  if (enabledTargets.includes('claude')) plans.push(planJsonTarget(`claude ${path.relative(hubRoot, root)}`, path.join(root, '.mcp.json'), 'mcpServers', servers, claudeCursorEntry));
  if (enabledTargets.includes('cursor')) plans.push(planJsonTarget(`cursor ${path.relative(hubRoot, root)}`, path.join(root, '.cursor', 'mcp.json'), 'mcpServers', servers, claudeCursorEntry));
  if (enabledTargets.includes('opencode')) plans.push(planJsonTarget(`opencode ${path.relative(hubRoot, root)}`, path.join(root, 'opencode.json'), 'mcp', openCodeServers, opencodeEntry));
  if (enabledTargets.includes('codex')) plans.push(planCodexTarget(`codex ${path.relative(hubRoot, root)}`, path.join(root, '.codex', 'config.toml'), servers));
}

let driftCount = 0;
for (const plan of plans) {
  const icon = { noop: '=', written: '+', planned: '~', drift: '!' }[plan.status];
  console.log(`[${icon}] ${plan.status.padEnd(7)} ${plan.label} → ${plan.detail}`);
  if (plan.status === 'drift') driftCount += 1;
  if (!dryRun && plan.apply) plan.apply();
}

if (driftCount > 0) {
  console.error(`\nsync-agents: ${driftCount} managed section(s) drifted from canonical config. Re-run with --force to overwrite.`);
  process.exit(2);
}
console.log(dryRun ? '\nsync-agents: dry-run complete.' : '\nsync-agents: sync complete.');
