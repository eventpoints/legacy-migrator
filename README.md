# legacy-migrator

AI-assisted pipeline for migrating a legacy application to a modern stack.

Proprietary. Copyright (c) 2026 Kerrial Newham. All rights reserved. Not open
source — see [LICENSE](./LICENSE).

## The core idea

A code-to-code rewrite is one opaque, unverifiable leap. This pipeline splits it
into two independently verifiable stages with a human checkpoint in between:

```
legacy repo + readonly DB schema
        │
        ▼
  [1] EXTRACT  ──►  requirements artifact  ◄── human review & correction
        │            (hierarchical, traceable, testable)
        ▼
  [2] GENERATE ──►  new schema · code · tests · data mapping
```

The **requirements artifact** is the backbone. Every downstream stage derives
from it, never directly from the legacy code. It is the thing a human can
actually review and correct.

## Status

Stage 0 — the requirements format — is implemented:

- `src/schema/requirements.ts` — the artifact schema (Zod, single source of truth)
- `src/schema/coverage.ts` — the extraction-coverage metric
- `schema/requirements.schema.json` — exported JSON Schema (run `npm run schema:export`)
- `examples/orders.requirements.json` — a worked example

Not yet built: repo ingest, the extraction agent, and the generation stages.

## Two load-bearing properties

1. **Traceability.** Every rule links down to the exact legacy source lines it
   was derived from. Inverting those links measures what fraction of the legacy
   code is *claimed* by a requirement — the unclaimed remainder is the
   completeness gap (errors of omission), the one extraction error human review
   cannot catch on its own.

2. **Testability.** Rules are Given/When/Then behavioral specs, so they compile
   into characterisation tests.

See [docs/requirements-format.md](./docs/requirements-format.md) for the format.

## Commands

```bash
npm install
npm run typecheck          # type-check the project
npm run schema:export      # regenerate schema/requirements.schema.json
npm run example:validate   # validate the example document
npm run coverage:demo      # demonstrate the coverage metric + gap detection
```
