---
relates-to: [plans/_INSTRUCTION]
---

# Project Memory Index — shared hub

Durable, cross-session project memories shared across **all** agents (Claude Code, Codex,
Cursor, OpenCode, …). Read these before making assumptions about local workflows, data state,
or prior decisions.

**Convention:** one fact per file (kebab-case slug). Body may carry light frontmatter
(`description`, `type`) and link related memories with `[[slug]]`. Declare durable relations in
`relates-to` frontmatter; `node .agents/_tools/graph.mjs build|neighbors` walks them. New project
memories go **here**, not in any agent-private memory store. One line per file below — hook only,
content lives in the file.

> Per-feature design/decision history lives in `plans/<feature>/`, not here. This store holds
> only durable, cross-feature facts.

## Index

**Project facts**

- (none yet)

**Working preferences (feedback)**

- (none yet)
