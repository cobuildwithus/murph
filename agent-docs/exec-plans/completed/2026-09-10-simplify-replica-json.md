# Share browser replica JSON value copying

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Give browser replica construction and experiment projection one internal owner
  for their existing JSON admission and detached-copy behavior.

## Success criteria

- Remove the two duplicate functions from both consumers without changing
  accepted values, output bytes, field allowlists, or nullable-record behavior.
- Pass focused value/copy tests, composed replica privacy and experiment tests,
  browser entry checks, query typecheck, and the complexity guard.

## Scope

- In scope: query browser-replica build/experiments, internal json-values module,
  focused tests, and this plan.
- Out of scope: views/shared/barrels owned by PR #3167, public exports,
  cooperative serialization, stricter input validation, and model calculations.

## Constraints

- Keep builder allowlists and the experiment nullable-record wrapper in place.
  Preserve existing JSON.stringify handling of non-finite numbers, sparse arrays,
  object prototypes, and unsupported nested values.
- Use the assigned isolated worktree from pinned main b80bd40f. Open a draft;
  the parent owns Ready, final ReviewGPT, exact-head CI, and merge decisions.

## Risks and mitigations

1. A generic JSON cleanup could change admission or expose extra replica fields.
   Mitigation: move the builder functions unchanged, retain its allowlists, and
   prove rejection and detached-copy semantics through existing callers.
2. Importing the cooperative serializer would couple browser consumers to yielding.
   Mitigation: use a dependency-free internal value module; leave json.ts intact.

## Tasks

1. Confirmed exports, callers, policy equivalence, test ownership, and PR overlap.
2. Moved the builder functions unchanged and replaced both imports.
3. Added focused admission, serialization, allowlist, and detached-copy proof.
4. Passed focused tests, query typecheck, complexity, and full diff/privacy review.
5. Delivery: scoped completion commit and draft PR; parent owns final gates.

## Decisions

- The existing cooperative json.ts has a different asynchronous responsibility.
  The new module contains only the two real shared functions; no new policy,
  adapter, public surface, persisted state, or deploy ordering is introduced.
- The pinned implementations matched in 27 synthetic value cases before editing.
- No changelog: internal consolidation preserves member-visible behavior.

## Verification

- PASS: pnpm --dir packages/query exec vitest run --config vitest.config.ts
  --no-coverage --maxWorkers=2 test/browser-replica-json-values.test.ts
  test/browser-vault-replica.test.ts test/browser-vault-experiment-results.test.ts
  test/browser-entry-boundary.test.ts test/browser-entry-surface.test.ts
  (130 tests across 5 files).
- PASS: pnpm --dir packages/query typecheck.
- PASS: pnpm complexity:diff --base b80bd40f84d1b367c1810e2fe046e3089cc28aa4.
  Three source files; two exact moves; zero debt or maximum regressions.
- Existing experiment hotspots inspected: buildProgressResult (73),
  buildRunContext (48), classifyCoverageStatus (24), persisted metric mapping (21).
  They retain their experiment policy responsibility and are unchanged.
- PASS: git diff --check; no public surface or PR #3167 file changes.
- Existing privacy fields remain excluded, invalid nested values remain rejected,
  and source, replica, and result copies retain independent nested objects.
- Frozen dependency install and scripts/frog list succeeded; no new repository
  friction entry was needed. Broad CI and final ReviewGPT remain parent-owned.
Completed: 2026-09-10
