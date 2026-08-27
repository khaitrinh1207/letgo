# Plans schema catalog

`feature.yml` uses JSON-compatible YAML so the portable hub CLI needs no package installation.

## Lifecycle

`active | maintenance | superseded`

## Change types

`feature | fix | update | maintenance`

## Environment evidence

Each DEV, STG, and PROD record declares:

- `mergeState`: `not-created | opened | merged | closed | unknown | not-required`
- `deploymentState`: `pending | reported | confirmed | verified | unknown | not-required`
- `qcState`: `pending | passed | failed | unknown | not-required`
- Optional evidence: MR ID/URL, merge or squash SHA, verified ref, source, and observed time.

MR evidence never changes deployment state automatically. PROD evidence requires an operational
source or explicit human confirmation.

## Context routes

Every route is an ordered list of feature-relative paths. Routes are purpose-specific and must not
use an index as a fan-out link to every document. Two intents must not return the same documents —
`doctor` rejects that, because it means an intent has stopped answering its own question.

## Repositories

Each entry declares `id` (referenced by `branches`), `path` relative to the workspace,
`documentedRevision` — the commit the feature's documents were last verified against — and
`scopedPaths`. `compare` diffs `documentedRevision..HEAD` over those paths. It is HEAD-relative, so
the file count changes with the checked-out branch and is not a staleness metric on its own: use it
to see WHICH files moved, then read them against the implementation document. Move
`documentedRevision` only after that reading — re-anchoring without it replaces a stale claim with
an unfounded one and destroys the signal that review is needed.

## Branches and per-repository evidence

A deliverable may carry `branches`, mapping a repository id to the one branch its work lives on.
Environment evidence may carry `repositories`, keyed the same way, each holding that side's `mr`,
`mergeState`, `commit`, `verifiedRef` and `observedAt` — so two repositories cannot overwrite each
other, and the environment reads `merged` only when every branched repository reports merged.

## Runtime flow

`artifacts/runtime-flow.md` maps each entry surface through controller/handler, owning service,
transport, downstream services, and data stores. It names the code revision and known environment
differences.

## Production checklist

Every required section contains an action and evidence or `N/A — reason`: delivery surfaces,
access/edge configuration, data model, indexes, backfill, configuration/resources, deployment
order, validation/QC, and rollback.

