#!/usr/bin/env node

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = path.resolve(scriptDir, '..');
const GRAPH_FILE = path.join(HUB_ROOT, '_graph.json');

// Skills mirror sources of truth outside this repo; index them but never mutate.
const READ_ONLY_PREFIXES = ['skills/'];
const MUTABLE_EXTENSIONS = ['.md'];

const args = process.argv.slice(2);
const command = args[0];
const flag = (name) => args.includes(name);
const optionValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

function walkMarkdownFiles(dir, base = dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownFiles(full, base, acc);
    } else if (MUTABLE_EXTENSIONS.includes(path.extname(entry.name))) {
      acc.push(path.relative(base, full));
    }
  }
  return acc;
}

const toNodeId = (relativePath) => relativePath.replace(/\.md$/, '');
const fromNodeId = (id) => `${id}.md`;

function normalizeNodeId(candidate, fromDirId) {
  let cleaned = candidate.trim().replace(/^\.?\//, '');
  if (!cleaned) return null;
  cleaned = cleaned.replace(/\.md$/, '');

  const attempts = [];
  if (/^(\.\.\/|\.\/)/.test(candidate) || cleaned.includes('/')) {
    attempts.push(path.posix.normalize(path.posix.join(fromDirId, cleaned)));
    attempts.push(cleaned);
  } else {
    // Bare filename or slug resolution order: same directory first, then memories,
    // then a unique basename anywhere.
    attempts.push(path.posix.join(fromDirId, cleaned));
    attempts.push(`memories/${cleaned}`);
  }

  for (const attempt of attempts) {
    if (!attempt.startsWith('..') && existsSync(path.join(HUB_ROOT, fromNodeId(attempt)))) return attempt;
  }

  // Folder-style reference (`../other-feature/`) points at that feature's index.
  const folderCandidate = String(attempts[0] ?? cleaned).replace(/\/+$/, '');
  if (folderCandidate.startsWith('..')) return null;
  if (existsSync(path.join(HUB_ROOT, folderCandidate)) && existsSync(path.join(HUB_ROOT, fromNodeId(`${folderCandidate}/index`)))) {
    return `${folderCandidate}/index`;
  }

  if (!cleaned.includes('/')) {
    const matches = allNodeIds().filter((id) => id.endsWith(`/${cleaned}`));
    if (matches.length === 1) return matches[0];
  }
  return null;
}

let nodeIdCache = null;
function allNodeIds() {
  if (!nodeIdCache) {
    nodeIdCache = walkMarkdownFiles(HUB_ROOT).map(toNodeId);
  }
  return nodeIdCache;
}

function splitFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return { frontmatter: null, body: text };
  return { frontmatter: match[1], body: text.slice(match[0].length) };
}

function parseRelatesTo(frontmatter) {
  if (!frontmatter) return [];
  const inline = /^\s*relates-to:\s*\[([^\]]*)\]/m.exec(frontmatter);
  if (inline) {
    return inline[1].split(',').map((item) => item.trim()).filter(Boolean);
  }
  const block = /^\s*relates-to:\s*$\n((?:[ \t]+-[ \t]*[^\n]+\n?)+)/m.exec(frontmatter);
  if (block) {
    return block[1]
      .split('\n')
      .map((line) => line.replace(/^\s*-\s*/, '').trim())
      .filter(Boolean);
  }
  return [];
}

function extractLinkCandidates(text) {
  const candidates = [];
  for (const match of text.matchAll(/\[\[([^\]\n]+?)\]\]/g)) {
    candidates.push({ raw: match[1].split(/[|#]/)[0], kind: 'wikilink' });
  }
  for (const match of text.matchAll(/\]\(([^)\s]+?\.md)(?:#[^)]*)?\)/g)) {
    candidates.push({ raw: match[1], kind: 'path' });
  }
  for (const match of text.matchAll(/`([^`\n]+?\.md)`/g)) {
    candidates.push({ raw: match[1], kind: 'path' });
  }
  for (const match of text.matchAll(/`((?:\.\.?\/)?[A-Za-z0-9][\w.-]*\/)`/g)) {
    candidates.push({ raw: match[1], kind: 'path' });
  }
  return candidates;
}

function extractEdges(nodeId, body) {
  const edges = new Map();
  for (const candidate of extractLinkCandidates(body)) {
    const target = normalizeNodeId(candidate.raw, path.posix.dirname(nodeId));
    if (!target || target === nodeId) continue;
    edges.set(target, { to: target, kind: candidate.kind });
  }
  return [...edges.values()];
}

function nodeType(id) {
  if (id.startsWith('memories/')) return 'memory';
  if (id === 'plans/_INSTRUCTION') return 'meta';
  if (id === 'memories/README') return 'memory-index';
  if (/^plans\/[^/]+\/index$/.test(id)) return 'feature-index';
  const named = id.match(/^plans\/[^/]+\/(requirement|qa|db-mapping|flow|mockup-ui|issues|references|structure)$/);
  if (named) return named[1];
  if (/^plans\/[^/]+\/topics\//.test(id)) return 'topic';
  if (/^plans\/[^/]+\/work\/[^/]+\/plan$/.test(id)) return 'plan';
  if (/^plans\/[^/]+\/work\/[^/]+\/index$/.test(id)) return 'work-index';
  if (/^plans\/.+\/verification\//.test(id)) return 'verification';
  if (id.startsWith('plans/')) return 'plan-doc';
  if (id.startsWith('docs/')) return 'doc';
  if (id.startsWith('environments/')) return 'ops';
  if (id.startsWith('context/')) return 'context';
  if (id.startsWith('skills/')) return 'skill';
  return 'doc';
}

function buildGraph() {
  const nodes = [];
  const edges = [];
  const broken = [];

  for (const id of allNodeIds()) {
    nodes.push({ id, type: nodeType(id) });

    const { frontmatter, body } = splitFrontmatter(readFileSync(path.join(HUB_ROOT, fromNodeId(id)), 'utf8'));
    for (const declared of parseRelatesTo(frontmatter)) {
      const target = normalizeNodeId(declared, path.posix.dirname(id));
      if (!target) {
        broken.push({ from: id, to: declared, kind: 'declared' });
        continue;
      }
      if (target !== id) edges.push({ from: id, to: target, kind: 'declared' });
    }
    for (const edge of extractEdges(id, body)) {
      edges.push({ from: id, to: edge.to, kind: edge.kind });
    }
  }

  const deduped = dedupeEdges(edges);
  return { generatedAt: new Date().toISOString(), nodes, edges: deduped, broken };
}

function dedupeEdges(edges) {
  const byPair = new Map();
  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}`;
    const existing = byPair.get(key);
    if (!existing || (existing.kind !== 'declared' && edge.kind === 'declared')) {
      byPair.set(key, edge);
    }
  }
  return [...byPair.values()];
}

function cmdBuild() {
  const graph = buildGraph();
  writeFileSync(GRAPH_FILE, JSON.stringify(graph, null, 2) + '\n');
  console.log(`nodes=${graph.nodes.length} edges=${graph.edges.length} broken=${graph.broken.length}`);
  console.log(`written: ${path.relative(process.cwd(), GRAPH_FILE)}`);
}

function loadGraph() {
  if (!existsSync(GRAPH_FILE)) {
    console.error('No _graph.json yet. Run: node graph.mjs build');
    process.exit(1);
  }
  return JSON.parse(readFileSync(GRAPH_FILE, 'utf8'));
}

function cmdNeighbors(rootId, depth = 1) {
  const graph = loadGraph();
  const ids = new Set(graph.nodes.map((node) => node.id));

  const adjacency = new Map();
  const addLink = (from, link) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push(link);
  };
  for (const edge of graph.edges) {
    // Traversal is undirected like an Obsidian graph; the kind label keeps provenance.
    addLink(edge.from, { to: edge.to, kind: edge.kind });
    addLink(edge.to, { to: edge.from, kind: `${edge.kind} (backlink)` });
  }

  const descriptions = new Map(
    graph.nodes.map((node) => [
      node.id,
      { type: node.type, description: nodeDescription(node.id) },
    ]),
  );

  if (!ids.has(rootId)) {
    console.error(`Unknown node: ${rootId}`);
    process.exit(1);
  }

  const visited = new Map([[rootId, 0]]);
  let frontier = [rootId];
  for (let level = 1; level <= depth; level += 1) {
    const next = [];
    for (const current of frontier) {
      for (const link of adjacency.get(current) ?? []) {
        if (visited.has(link.to)) continue;
        visited.set(link.to, level);
        next.push(link.to);
        console.log(`${'  '.repeat(level)}[${level}] ${link.kind}: ${link.to} (${descriptions.get(link.to).type})`);
        if (descriptions.get(link.to).description) {
          console.log(`${'  '.repeat(level)}    ${descriptions.get(link.to).description}`);
        }
      }
    }
    frontier = next;
  }
  console.log(`reachable within depth ${depth}: ${visited.size - 1}`);
}

function nodeDescription(id) {
  const filePath = path.join(HUB_ROOT, fromNodeId(id));
  const { frontmatter } = splitFrontmatter(readFileSync(filePath, 'utf8'));
  if (!frontmatter) return '';
  const description = /^description:\s*(.+)$/m.exec(frontmatter);
  return description ? description[1].slice(0, 140) : '';
}

function degreeMap(graph) {
  const degrees = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    degrees.set(edge.from, degrees.get(edge.from) + 1);
    degrees.set(edge.to, degrees.get(edge.to) + 1);
  }
  return degrees;
}

function cmdOrphans() {
  const graph = loadGraph();
  const degrees = degreeMap(graph);
  const routed = routedDocumentIds();
  for (const [id, degree] of degrees) {
    if (degree > 0) continue;
    const type = nodeType(id);
    if (type === 'skill' || routed.has(id)) continue;
    console.log(`${id} (${type})`);
  }
}

function routedDocumentIds() {
  const plansDir = path.join(HUB_ROOT, 'plans');
  const ids = new Set();
  if (!existsSync(plansDir)) return ids;
  for (const entry of readdirSync(plansDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join(plansDir, entry.name, 'feature.yml');
    if (!existsSync(manifest)) continue;
    const feature = JSON.parse(readFileSync(manifest, 'utf8'));
    const declared = [...Object.values(feature.contextRoutes ?? {}).flat(), ...Object.values(feature.artifacts ?? {})];
    for (const file of declared) ids.add(`plans/${entry.name}/${file.replace(/\.md$/, '')}`);
  }
  return ids;
}

function cmdBroken() {
  const graph = loadGraph();
  for (const entry of graph.broken) {
    console.log(`${entry.from} -> ${entry.to} (${entry.kind})`);
  }
}

function cmdMermaid(prefix) {
  const graph = loadGraph();
  const selected = graph.nodes.filter((node) => !prefix || node.id.startsWith(prefix)).map((node) => node.id);
  const allowed = new Set(selected);
  console.log('graph TD');
  for (const id of selected) console.log(`  ${mermaidId(id)}["${id}"]`);
  for (const edge of graph.edges) {
    if (allowed.has(edge.from) && allowed.has(edge.to)) {
      console.log(`  ${mermaidId(edge.from)} --> ${mermaidId(edge.to)}`);
    }
  }
}

const mermaidId = (id) => `n${id.replace(/[^A-Za-z0-9]/g, '_')}`;

function cmdSeed(mode) {
  const dryRun = mode !== '--apply';
  let changedFiles = 0;
  let addedTargets = 0;

  for (const id of allNodeIds()) {
    if (READ_ONLY_PREFIXES.some((prefix) => id.startsWith(prefix))) continue;

    const filePath = path.join(HUB_ROOT, fromNodeId(id));
    const original = readFileSync(filePath, 'utf8');
    const { frontmatter, body } = splitFrontmatter(original);

    const existing = parseRelatesTo(frontmatter);
    const discovered = extractEdges(id, body).map((edge) => edge.to);
    const additions = [...new Set(discovered)].filter((target) => !existing.includes(target));
    if (additions.length === 0) continue;

    const merged = [...existing, ...additions].sort();
    changedFiles += 1;
    addedTargets += additions.length;

    if (dryRun) {
      console.log(`${id}\n  + ${additions.sort().join(', ')}`);
      continue;
    }

    writeFileSync(filePath, renderWithRelatesTo(original, frontmatter, body, merged));
  }

  console.log(`\n${dryRun ? 'DRY RUN' : 'APPLIED'}: ${changedFiles} files, ${addedTargets} edge targets`);
}

function cmdNormalize() {
  let fixedFiles = 0;
  const dropped = [];

  for (const id of allNodeIds()) {
    if (READ_ONLY_PREFIXES.some((prefix) => id.startsWith(prefix))) continue;

    const filePath = path.join(HUB_ROOT, fromNodeId(id));
    const current = readFileSync(filePath, 'utf8');
    const parts = splitFrontmatter(current);
    const entries = parseRelatesTo(parts.frontmatter);
    if (entries.length === 0) continue;

    const canonical = [];
    for (const entry of entries) {
      const collapsed = entry.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
      let target = existsSync(path.join(HUB_ROOT, fromNodeId(collapsed)))
        ? collapsed
        : null;
      if (!target && existsSync(path.join(HUB_ROOT, fromNodeId(`${collapsed}/index`)))) {
        target = `${collapsed}/index`;
      }
      if (target && !canonical.includes(target)) canonical.push(target);
      if (!target) dropped.push({ from: id, to: entry });
    }

    canonical.sort();
    if (canonical.join('|') === entries.sort().join('|')) continue;
    writeFileSync(filePath, renderWithRelatesTo(current, parts.frontmatter, parts.body, canonical));
    fixedFiles += 1;
  }

  for (const { from, to } of dropped) console.log(`dropped unresolvable: ${from} -> ${to}`);
  console.log(`normalized: ${fixedFiles} files`);
}

function renderWithRelatesTo(original, frontmatter, body, merged) {
  const line = `relates-to: [${merged.join(', ')}]`;
  if (frontmatter === null) {
    return `---\n${line}\n---\n\n${original}`;
  }

  const lines = frontmatter.replace(/\n$/, '').split('\n');
  const kept = [];
  let skippingList = false;
  for (const current of lines) {
    if (/^\s*relates-to:\s*\[[^\]]*\]\s*$/.test(current)) {
      skippingList = false;
      continue;
    }
    if (/^\s*relates-to:\s*$/.test(current)) {
      skippingList = true;
      continue;
    }
    if (skippingList && /^\s+-\s+/.test(current)) continue;
    skippingList = false;
    kept.push(current);
  }
  while (kept[0] === '') kept.shift();
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();
  const updated = kept.length > 0 ? `${kept.join('\n')}\n${line}` : line;
  return `---\n${updated}\n---\n${body}`;
}

const invokedDirectly = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  switch (command) {
    case 'build':
      cmdBuild();
      break;
    case 'neighbors':
      cmdNeighbors(args[1], Number(optionValue('--depth') ?? 1));
      break;
    case 'orphans':
      cmdOrphans();
      break;
    case 'broken':
      cmdBroken();
      break;
    case 'mermaid':
      cmdMermaid(optionValue('--feature') ?? args[1]);
      break;
    case 'seed':
      cmdSeed(flag('--apply') ? '--apply' : '--dry');
      break;
    case 'normalize':
      cmdNormalize();
      break;
    default:
      console.log('usage: graph.mjs <build|seed [--apply]|normalize|neighbors <id> [--depth N]|orphans|broken|mermaid [prefix]>');
  }
}

export { dedupeEdges, extractEdges, renderWithRelatesTo, splitFrontmatter };
