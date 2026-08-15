# Junction timeseries ReviewGPT remediation

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

Resolve the final-review findings without adding another cursor, watermark,
store, or writer: dense Junction fidelity resources must have one closed-day
owner, and every compact resolution of a resource must share provider revision
ordering.

## Success criteria

- Direct dense resource jobs and reconcile jobs both import only complete
  provider calendar dates, in either execution order and with or without
  provider revisions.
- Sparse caffeine, water, and mindfulness direct jobs retain precise windows.
- Each of the six existing daily facts carries the same explicit provider
  revision as its feature or interval companion.
- A versioned event may migrate the pre-versioning baseline once; later stale
  replay cannot split current daily and companion facts.
- Focused tests, typechecks, package build, scenario integrity, exact-head CI,
  and final ReviewGPT all pass.

## Scope

- In scope: Junction transport routing, importer external references, narrow
  core revision reconciliation, query proof, and their owner documentation.
- Out of scope: new resources, raw-stream retention, runtime state, migrations,
  user-interface changes, and unrelated device providers.

## Constraints

- Technical constraints: reuse the existing closed-day importer and event
  spine; preserve existing daily facts and all explicit response/output bounds.
- Product/process constraints: keep health evidence private, use synthetic
  fixtures, and complete the exact-head PR review workflow.

## Risks and mitigations

1. A precise dense job could still create a partial-day winner.
   Mitigation: route every dense job through the one closed-day owner and test
   non-UTC records in both resource/reconcile orders.
2. Rolling deployment could leave unversioned baseline events.
   Mitigation: permit exactly the existing event spine to replace an unordered
   baseline with an explicit ISO provider revision; all later changes require
   comparable monotonic revisions.
3. Broad revision logic could alter unrelated providers or Junction resources.
   Mitigation: gate reconciliation on the six resource suffixes and their
   explicit daily/feature/interval facets.

## Tasks

1. Reuse closed-day imports for dense direct resource jobs while preserving
   precise sparse jobs and yield behavior.
2. Propagate selected explicit revisions to all daily and companion facts.
3. Add narrow rollout-aware core reconciliation and stale-replay proof.
4. Update owner docs, run focused verification, commit and push the exact head.
5. Run ReviewGPT concurrently with CI and remediate until both pass.

## Decisions

- Reuse the existing daily importer instead of creating partial-day state or a
  second aggregation owner.
- Keep migration authority in the existing event-spine reconciliation seam;
  no background rewrite is required.

## Verification

- Importer Junction suites: 201 tests pass.
- Device-syncd package suite: 973 tests pass, including the four-case dense
  transport-order matrix and the sparse precise-window regression.
- Query normalized wearable suite: 17 tests pass.
- Core, importer, device-syncd, and query typechecks pass.
- Importer safe build, scenario integrity, docs drift, diff check, and privacy
  scan pass.
- Required exact-head CI is green and final ReviewGPT reports zero findings.
Completed: 2026-08-11
