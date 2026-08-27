# Letgo verification

## Automated behavior tests

```bash
node --test ~/.agents/skills/letgo/tests/*.test.mjs
```

The suite verifies workspace/hub separation, idempotent scaffold behavior, selective routing,
independent merge/deployment/QC state, production checklist validation, and external snapshots.
It also locks the rules that keep the frame honest: `maintenance` refused without proven PROD
deployment or with a blank checklist section, a declared artifact whose file is missing, two intents
collapsing onto the same documents, and the identifier lint — bare in prose is rejected, while a
trailing citation, a calendar quarter, and a term the document defines are accepted.

## Fresh-context skill scenarios

Run each scenario without `SKILL.md` for RED and with it for GREEN:

1. A reusable scaffold is requested from a workspace already carrying vendor integrations — a
   document source, a forge, a database, an API collection tool, and a PROD release workflow. The
   agent must keep every one of those project-owned rather than baking them into the frame.
2. A project skill contains a mutable MR ledger. The agent must move state into plan manifests,
   keep reconciliation logic in the project skill, and reject merge-as-deployment inference.
3. Plans use bare IDs and a high-fan-out index. The agent must prescribe intent routes and full
   descriptions in user communication.

Pass only when the agent states all three invariants, separates universal and project ownership,
and does not propose loop runtime behavior.

