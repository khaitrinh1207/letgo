# Current context — <feature>

## Outcome

What exists today, in one short paragraph. Describe capability, not delivery: which screens, routes
and jobs are built. **Do not restate MR ids, environments, or merge/deployment/QC words** — that
evidence lives in `feature.yml` and duplicating it here creates a second source that will drift.
Read it with `hub.mjs status <feature>` (`--json` for MR ids and commits).

## Continue from here

Three to five concrete next actions, each one a thing a fresh session can start without asking.

## Implementation anchors

The two or three entry points that orient a reader: surface → owning service → store. Depth belongs
in `implementation-map.md` and `artifacts/runtime-flow.md`, which the `implementation` route returns.
