---
name: letgo
description: Use when bootstrapping, auditing, migrating, or synchronizing a workspace-wide `.agents/` context hub shared by multiple coding agents or repositories.
---

# Letgo

## Purpose

Build and govern the reusable frame for a workspace-wide `.agents/` hub. The hub is agent-only
context; it does not implement product features or run autonomous agent loops.

Three invariants define every decision:

1. `letgo` owns the reusable frame, schemas, templates, and deterministic validators.
2. `.agents/` is the shared context hub for every agent working in the workspace.
3. `_config/`, `scripts/`, and `skills/` contain project/workspace-specific extensions.

## Modes

| Request | Action |
|---|---|
| No hub exists | Scaffold with `scripts/scaffold.mjs` |
| Hub exists | Audit structure, versions, routes, evidence, and tool drift |
| Layout is obsolete | Snapshot first, migrate, then compare old and new |
| Runtime discovery differs | Synchronize skill/config bridges and run doctor |

## Scaffold

Discover existing workspace instructions, repository roots, docs sources, and runtime configs.
Then run:

```bash
node <skill>/scripts/scaffold.mjs \
  --workspace <workspace-root> \
  --hub <workspace-root>/.agents \
  --project "<name>" \
  --repos repo-a,repo-b
```

The workspace root owns `AGENTS.md`; the hub owns `README.md` and agent context. Scaffold is
idempotent and never overwrites an existing file.

## Universal frame versus project extensions

Universal frame:

- `context/`, `plans/`, `memories/`, `docs/`, `environments/`
- portable `_tools/`
- secret-free configuration schemas
- canonical project skill directory and bridge declarations

Project extensions:

- vendor adapters such as SharePoint or GitLab
- environment names and release rules
- Postman, database, infrastructure, and operational scripts
- project skills and MCP registrations

Do not bake the current project's providers, branch names, services, credentials, or deployment
workflow into universal templates. A universal checklist defines categories; a project skill fills
and verifies project-specific actions.

## Agent-only authoring contract

- Write concise, evidence-backed English.
- Preserve exact domain labels and external quotations when translation would change meaning.
- Keep IDs for traceability, but outside their defining table write `ID — description`.
- In chat, state the full problem, impact, evidence, and next action; never report only `I1`, `D1`,
  or another internal identifier.
- Route context by intent. Do not make an index link every document.

## Plans and evidence

Every feature uses `feature.yml` as the machine source for lifecycle, context routes, scoped code
revisions, deliverables, and DEV/STG/PROD evidence. The registry is a generated summary.

Keep these facts independent:

- MR/merge state
- environment deployment state
- runtime verification
- QC result

A merged MR never proves deployment. Missing evidence stays `unknown`. PROD requires operational
evidence or explicit human confirmation. Run `hub.mjs --help` behavior through its usage error and
the templates for exact fields.

What `doctor` enforces, so the templates and the tool cannot drift apart:

- every declared `artifacts` file exists;
- every `contextRoutes` file exists, and no two intents return the same documents — an intent that
  duplicates another has stopped answering its own question;
- `maintenance` requires confirmed-or-verified PROD deployment and a checklist with no blank section;
- an identifier used in routed prose must be resolvable there — as a trailing citation, or defined
  in that document. `doctor --all-documents` widens the sweep to every feature document except
  `archive/`, as a backlog rather than a gate.

Two shapes the frame provides but does not mandate: `branches`, one branch per repository per
deliverable, and per-repository environment evidence under `repositories`, so two repositories
recording the same environment cannot overwrite each other. A project that ships one repository per
deliverable simply never uses them.

A PROD release procedure is written once and executed once. Keep the nine-section
`prod-checklist.md` as the contract and put each executable round in its own file, so a round
already deployed is never rewritten.

## Safe migration

1. Run RED behavior tests before changing this skill or its tools.
2. Install the new snapshot/status tooling.
3. Snapshot `plans/` outside the hub with a manifest inside the hub.
4. Migrate every registered feature, then render the registry.
5. Compare inventory and hashes; review removed or changed semantic content.
6. Move old folders only after their replacement validates.
7. Remove obsolete data or integrations only after reference checks and explicit approval.

## Required verification

```bash
node <skill>/tests/*.test.mjs
node <hub>/_tools/hub.mjs doctor
node <hub>/_tools/hub.mjs registry check
node <hub>/_tools/graph.mjs build     # rewrites _graph.json
node <hub>/_tools/graph.mjs broken    # reads _graph.json, so build first
```

Skill edits require fresh-context RED/GREEN scenarios under `writing-skills`. Generic code tests
run in temporary workspaces and must not mutate a real project hub.

