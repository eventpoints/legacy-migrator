# The requirements artifact format

The requirements document is the explicit, human-reviewable specification
extracted from a legacy codebase. It is the single source of truth for every
later stage of the pipeline.

The authoritative definition is the Zod schema in
[`src/schema/requirements.ts`](../src/schema/requirements.ts); a JSON Schema is
generated from it into `schema/requirements.schema.json`.

## Hierarchy

```
RequirementsDocument
└─ Slice            vertical slice / bounded context (e.g. "Orders")
   └─ Feature       a capability (e.g. "Checkout")
      └─ Rule       one testable behavioral rule (Given/When/Then)
         └─ DataTouchpoint   a table/columns the rule reads or writes
```

Every level carries `sourceRefs` (traceability) and a `status` (review state).

## Node reference

### SourceRef — the unit of traceability

Points back into the legacy code. A rule with no `sourceRefs` is not extracted,
it is invented — the schema rejects it.

| Field | Notes |
|-------|-------|
| `file` | repo-relative path |
| `symbol` | enclosing function/method/class (optional) |
| `startLine` / `endLine` | inclusive 1-based range; `endLine >= startLine` |

### Rule — the testable leaf

| Field | Notes |
|-------|-------|
| `id` | stable dotted id, e.g. `orders.checkout.free-shipping` |
| `given` / `when` / `then` | behavioral spec; `then` must assert at least one outcome |
| `dataTouchpoints` | tables/columns touched — drives schema design + data mapping |
| `sourceRefs` | **required, non-empty** — where the rule came from |
| `confidence` | extractor self-rating 0..1; low confidence ⇒ review first |
| `status` | `extracted` \| `reviewed` \| `corrected` \| `rejected` |

### Review lifecycle

- **extracted** — produced by the AI, not yet seen by a human
- **reviewed** — a human confirmed it unchanged
- **corrected** — a human edited it (errors of *commission* fixed here)
- **rejected** — flagged as a hallucination / not a real requirement

Errors of *omission* (a missing rule) are not caught here — they are caught by
the coverage metric.

## Coverage: catching omissions

A reviewer cannot spot a rule that was never written down. So completeness is
measured mechanically instead, in [`src/schema/coverage.ts`](../src/schema/coverage.ts):

1. Collect every `SourceRef` in the document.
2. For each legacy file, merge the claimed line ranges.
3. The lines **not** claimed by any requirement are the gap — the exact code we
   failed to understand, and where missed edge cases live.

Coverage is also the convergence signal for the extraction loop: keep extracting
until claimed coverage crosses a threshold and the unclaimed remainder is
confirmed dead code.

> v0 counts raw line ranges. A later pass will restrict the denominator to
> executable lines (excluding blanks/comments) via the AST, so coverage reflects
> understood *behavior* rather than understood *text*.

## Example

See [`examples/orders.requirements.json`](../examples/orders.requirements.json)
for a worked Orders slice with two checkout rules. Run `npm run coverage:demo`
to see the gap detection against that document.
