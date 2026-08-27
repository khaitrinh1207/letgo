# Plans authoring contract

> `_SPEC_VERSION: 5`

Plans are the durable feature context and delivery ledger. Agents read them through an explicit
intent route instead of recursively loading a feature directory.

## Required behavior

1. Every feature has `feature.yml`, `index.md`, `current-context.md`, `requirement.md`,
   `prod-checklist.md`, plus every file its `artifacts` block names. The manifest, not a fixed
   filename, is the contract — `doctor` validates each declared artifact exists.
2. `feature.yml` is the machine source for lifecycle, routes, scoped code revisions,
   deliverables, and environment evidence.
3. `_REGISTRY.md` is generated from manifests and contains summary state only.
4. Git merge, deployment, runtime verification, and QC are separate facts.
5. `maintenance` requires every active deliverable to have confirmed or verified PROD deployment
   and a completed production checklist.
6. Internal IDs remain trace keys. Outside their defining table, write `ID — description`; in chat,
   explain the complete context before optionally naming the ID.
7. Agent-owned prose is concise English. Preserve exact external quotations and domain labels.

## Reading order

Run `node .agents/_tools/hub.mjs route <feature> --intent <intent>` and read only the returned
files. Valid intents are `resume`, `business`, `implementation`, `release`, and `operations`.

Routes return prose only. Per-environment merge, deployment and QC evidence lives in `feature.yml`
and is never duplicated into prose, so reading a route is not enough to know where the work stands:
run `node .agents/_tools/hub.mjs status <feature>` alongside it whenever delivery state matters.

`status` prints the three states per environment and nothing else. **Use `status --json` when you
need the evidence behind them** — MR ids, branches, commits, observed times, notes. Those fields
exist only in `feature.yml`; the text output silently omits them.

`node .agents/_tools/hub.mjs compare <feature>` reports whether the code moved since the manifest's
`documentedRevision`. It is the only staleness detector; run it before trusting an implementation
document.

## Where to write

Each document answers ONE question, and each intent routes to the documents that answer it. Write
into the document that owns the question you just answered — never into whichever file you happened
to have open, and never the same fact twice.

- **Do not restate a decision.** The decision log defines it; every other document states the
  behaviour in its own words and cites the identifier parenthetically. Copying the rationale creates
  a second source that will drift.
- **Do not widen a route to compensate for writing in the wrong place.** If a route does not answer
  its question, the answer is missing from the owning document, not from the route.
- **Two intents must never return the same documents.** `doctor` rejects that: it means at least one
  intent has stopped answering its own question.
- **An identifier is a trace key, never the content.** Write the behaviour, then cite the
  identifier, so a reader who loaded only this route still understands the sentence. Identifiers are
  feature-scoped: the same one means different things in different features, so never carry one
  across a feature boundary without naming the feature.

## Evidence updates

- Record a source revision only after inspecting the corresponding code.
- Reconcile DEV/STG MR evidence when the user reports a merge or asks for live status.
- Never infer deployment from an MR or branch ref.
- Keep unavailable evidence as `unknown`; do not fill gaps from expectation.
- Update `artifacts/runtime-flow.md` after the as-built request path changes.

## Required checks

After plan changes:

```bash
node .agents/_tools/hub.mjs doctor
node .agents/_tools/hub.mjs registry check
node .agents/_tools/graph.mjs build     # rewrites _graph.json
node .agents/_tools/graph.mjs broken    # reads _graph.json, so build first
```

`graph broken` covers **declared `relates-to` frontmatter only**. Inline links are resolved but a
failure is discarded, not reported — an empty `broken` is not proof that every link resolves.

`doctor` enforces the identifier rule on routed documents only. `doctor --all-documents` sweeps
every feature document except `archive/`; treat its output as a cleanup backlog, not a gate.

