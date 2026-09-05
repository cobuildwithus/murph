# Simplify experiment edit orchestration

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Remove repeated experiment edit dispatch logic while preserving public flags,
  canonical payloads, write ordering, and failure timing.

## Success criteria

- Focused CLI experiment tests, package typecheck, and complexity guard pass.
- Direct proof covers scalar, structured, hydration, mixed edits, and failure cutoffs.
- Parent candidate review, exact-head ReviewGPT, and required CI pass on the open PR.

## Scope

- In scope: experiment edit handler and focused registered-CLI proof.
- Out of scope: protocol startup defaults, schemas, core mutations, new CLI behavior.

## Constraints

- Preserve hydration then structured mutation then scalar update ordering.
- Keep option normalization at its existing effect boundary; retain error messages.
- Internal refactor: no Product UX change. Existing canonical readback journeys
  and focused dispatch proof establish unchanged behavior.

## Risks and mitigations

1. Scalar status could replay after structured writes. Preserve its omission on
   structured routes and assert service payloads and order.
2. Eager normalization could fail before a previously completed write. Keep the
   scalar payload inside an invocation-local closure called at the same exits.

## Tasks

1. Consolidate the duplicated analysis-field predicate and scalar write payload.
2. Delete guards proved unreachable from the earlier admission predicate.
3. Add focused dispatch and failure proof; run existing composed experiment tests.
4. Review, commit, open draft, obtain parent review, and run ReviewGPT with CI.

## Decisions

- Keep protocol plan construction intact; its complexity represents separate
  defaults and validation rules, not the repeated edit orchestration being removed.
- Use one local closure to replace three copies without adding mutable result state.

## Verification

- The existing 44 tests in the composed experiment/journal/vault phase-two suite
  passed. The added dispatch regression passed in a focused rerun after its
  synthetic fixture recorded the required completed safety screen.
- Registered-CLI proof covers eight scalar/structured/hydration combinations,
  status omission after structured writes, failure at each write stage, and
  canonical readback after a scalar failure preserves the earlier structured write.
- `pnpm --dir packages/cli typecheck` and `pnpm --dir packages/cli build` passed.
- Built `packages/cli/dist/bin.js` proof passed for protocol start, scalar and
  hydrated mixed edits, empty/invalid-tag rejection, and canonical title, paused
  status, and target-session readback through `experiment show`.
- `pnpm complexity:diff` passed: changed-file debt 172 to 154, with edit handler
  complexity 65. Remaining domain-default builders retain their existing owners.
- Parent source and final test review approved; exact-head ReviewGPT and required
  broad CI remain PR completion gates.
Completed: 2026-09-04
