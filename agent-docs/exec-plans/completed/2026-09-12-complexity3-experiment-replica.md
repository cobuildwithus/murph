# Simplify browser replica experiment progress derivation

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Outcome and protected invariant

Reduce branching in browser replica experiment progress without changing returned
adherence, coverage, readiness, phase, dates, or saved-outcome interpretation.
Replica queries remain read-only projections of the existing canonical evidence.

## Owner and evidence

`packages/query/src/browser-replica/experiments.ts` owns the browser result
selector. The supplied guard baseline is file debt 86 and maximum 73 in
`buildProgressResult`. That function repeats unknown-target gating and derives
session and confidence counts through overlapping occurrence/calendar/count
branches. It also mixes adherence derivation with primary-outcome coverage.

## Bounded change

GPT-6 Pro implemented the primary patch. Prefer one explicit unknown-adherence
exit and a clear choice among existing count sources, removing repeated checks
and unnecessary derivations. Keep any private helper at a real adherence or
coverage boundary in this file. Preserve existing shared counters and readiness
owners. No framework, public export, dependency, schema, state, or writer is
needed. The independent canonical experiment query owner is excluded.

## Failure and compatibility

Preserve unknown progress for unsupported or ambiguous targets even when schedule
evidence exists. Occurrence counts remain authoritative when available, while
expected-by-now stays null when the existing schedule/window gate is null.
Calendar-less targets do not gain assumptions. Omit zero confidence fields and
preserve null versus zero. Keep evidenceThrough, actual record dates, phase gates,
point-measurement windows, structured-review coverage, and diagnostic order.
Read-only control-flow changes require no persisted-format or deployment change.

## Proof and handoff

Use the public browser selector in the existing browser-results test file. Keep
its existing unknown-target, repeated occurrence, rollup, confidence, structured
review, missing/future evidence, paused run, and measurement-window coverage.
Add only focused missing regression cases for changed decisions. Run that suite
with one worker, query typecheck, and the scoped complexity guard after the patch
is downloaded and audited. Review complete result shape and read-only behavior.

The parent owns candidate review, Ready, final ReviewGPT, and CI. The exact
GPT-6 Pro attachment was audited and applied with no local source/test redesign.
The normal frozen pnpm install completed using the default shared store, and
Frog list passed afterward. No dependency files changed and no new task friction
entry was needed.

## Completed verification

- Parent verified the GPT-6 Pro model confirmation, captured response, request
  signature, and artifact hash. Local readback verified the attachment SHA-256
  `1585c25a14c51b875a93a299b3859afdec02f683c792b8db05341af9c965d8c3`.
  Applied source/test blobs exactly match the patch's resulting blob hashes.
- The existing null-target count owner returns all seven zero count/confidence
  fields immediately, before dates or observations; this preserves the old
  no-target fallback. Occurrence counts now avoid redundant observation and
  confidence derivation. The analysis plan is parsed once within coverage.
- `pnpm --filter @murphai/query exec vitest run --config vitest.config.ts
  --no-coverage --maxWorkers 1 test/browser-vault-experiment-results.test.ts`
  passed: one file, 108 tests. Eight added cases cover expected-null gating,
  structured-review phase gates, zero rollup overrides, and omitted confidence.
- `pnpm --filter @murphai/query typecheck` passed with one checker.
- `pnpm complexity:diff --base 486a6595e51bff2a6cfa64beb4ee1a953854a8b6
  -- packages/query/src/browser-replica/experiments.ts` passed: debt 86 to 50,
  maximum 73 to 48. Progress composition is now 1; adherence derivation is 36
  and coverage derivation 21. Unchanged hotspots remain run context 48,
  coverage classification 24, and the callback at line 823 at 21. Further
  fragmentation would hide meaningful count/coverage decisions.
- Full patch, result shape, privacy, and whitespace review passed. No new
  mutation, query, network operation, persisted format, or provider input.
- Changelog is not applicable: internal behavior-preserving simplification.
  Implementation is complete and ready for the draft PR handoff; final review
  and exact-head CI remain parent completion gates.
Completed: 2026-09-12
