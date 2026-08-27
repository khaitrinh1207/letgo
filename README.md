# letgo

One shared context hub for every coding agent in a workspace.

If you use more than one agent — Claude Code, Codex, Cursor, OpenCode — each one arrives with no
memory and reads whatever it happens to find. They drift apart, they re-derive the same facts, and a
long-running feature ends up documented in three places that disagree. `letgo` builds one directory,
`.agents/`, that all of them read, and gives it enough structure that it stays true.

It establishes conventions. It never implements features and never runs agent loops.

## What it creates

```
.agents/
├── README.md          entry point: intent routes, path ownership, invariants
├── plans/             one folder per feature: durable context AND delivery ledger
├── context/<repo>/    stable per-repository context
├── environments/      DEV/STG/PROD capability and constraint evidence
├── memories/          durable cross-session lessons
├── docs/              registry + adapters for documents that live elsewhere
├── _tools/            portable CLI: hub.mjs, graph.mjs, scaffold.mjs, sync-agents.mjs
└── _config/           repositories, environments, adapters, skill-bridge targets
```

## The two ideas that make it work

**Load a feature by intent, not by folder.** Reading a whole feature directory is what overloads a
continuation session. Each feature declares routes, and an agent asks for one:

```bash
node .agents/_tools/hub.mjs route <feature> --intent implementation
node .agents/_tools/hub.mjs status <feature>
```

`route` returns only the documents that answer that question. `status` returns the delivery
evidence, which prose never duplicates.

**Delivery is four separate facts, per environment.** Lifecycle, merge state, deployment state and
QC result never imply one another. A merged MR is not a deployment; a deployment is not QC. Evidence
you cannot establish stays `unknown` rather than being filled in from expectation. `hub.mjs doctor`
enforces this, along with: every declared artifact exists, no two intents return the same documents,
and `maintenance` requires proven PROD deployment plus a checklist with no blank section.

## Install

Copy this directory to wherever your agent runtime discovers skills — for Claude Code that is
`~/.claude/skills/letgo/` or `<project>/.claude/skills/letgo/`. Then ask your agent to bootstrap a
hub, or run the scaffold directly:

```bash
node <skill>/scripts/scaffold.mjs \
  --workspace /path/to/workspace \
  --hub /path/to/workspace/.agents \
  --project "Your project" \
  --repos api,web
```

Scaffold is idempotent and never overwrites an existing file, so it is safe to re-run on a hub that
already exists.

## Requirements

**Node 20.11 or newer.** The tools use `import.meta.dirname`, added in 20.11. No npm packages, no
install step — everything imports from the Node standard library only.

## What it assumes about your process

Be aware of this before scaffolding. The frame is shaped by a three-tier, merge-request-based
delivery process: `dev` → `stg` → `prod`, with a nine-section production checklist. If you deploy
straight from `main`, or run trunk-based with feature flags instead of environments, the three
environment records will feel like ceremony you do not need.

The universal frame is the routing, the four-facts model, and the tooling. Everything vendor-shaped
— your forge, your document source, your database, your release runbook — stays a project
extension, in `scripts/` and project skills, never in the frame. That separation is the point, and
`doctor` will not let a project's workflow leak into the template.

## Verification

```bash
node --test <skill>/tests/*.test.mjs
```

`TESTING.md` also carries fresh-context scenarios for when you edit the skill itself.

## License

MIT — see `LICENSE`.
