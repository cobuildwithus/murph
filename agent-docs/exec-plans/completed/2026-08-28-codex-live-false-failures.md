# Fix Codex Live false failures

Status: completed
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Remove only false-negative Codex Live failures caused by the local harness,
  synthetic fixtures, or incidental assertions, without weakening assertions
  that protect user-visible outcomes, privacy, effect ownership, or cost.

## Success criteria

- Every changed assertion is tied to a proved semantically valid result or an
  incidental model step that the verification contract says not to assert.
- The local subscription runner pins the repository Codex CLI and preserves
  only the synthetic command environment required by live fixtures.
- Focused deterministic tests and representative live journeys pass on the
  exact candidate head.
- All 135 paid live journeys run across authenticated Codex homes after the
  candidate is complete, with remaining failures classified as product,
  stochastic, or still-unresolved harness behavior.

## Scope

- In scope: `assistant-codex-real-e2e.test.ts`, the guarded live-test runner,
  runner unit tests, and directly matching testing/verification docs when their
  contract changes.
- Out of scope: production assistant prompts, tool descriptions, runtime
  behavior, and fixes for genuine product failures found by the suite.

## Constraints

- Technical constraints: keep live journeys opt-in, preserve subscription auth
  in its existing Codex homes, never copy credentials, and retain exact effect
  assertions when they protect writes, sends, provider calls, or privacy.
- Product/process constraints: work on a task branch and PR, reuse existing
  Frog issues, run the preliminary ReviewGPT specialist pass against the exact
  pushed candidate, and let required CI own broad deterministic verification.

## Risks and mitigations

1. Risk: Relaxing an assertion could hide a real assistant regression.
   Mitigation: require trace evidence that the user outcome and owned effects
   were correct before replacing exact wording or incidental-step assertions.
2. Risk: A long full-suite rerun spans a moving `main`.
   Mitigation: pin the candidate head and run from the isolated worktree.
3. Risk: One malformed or exhausted Codex home contaminates a shard.
   Mitigation: preflight homes without reading auth values and use the bounded
   alternate-home contract before counting a shard.

## Tasks

1. Inventory which previously diagnosed false-failure mechanisms remain on
   current `main` and map them to exact assertions or harness boundaries.
2. Add deterministic proof for runner and fixture-environment corrections.
3. Patch only proved false-negative assertions and harness behavior.
4. Run focused deterministic tests, typecheck, and representative live journeys.
5. Commit and open the draft PR, then run required preliminary ReviewGPT and CI.
6. Run the complete 135-journey live suite in parallel and classify the residue.

## Decisions

- This is internal test infrastructure; Product UX is not applicable because no
  production prompt, action, reply, or runtime behavior will change.
- Duplicate writes, sends, or provider calls remain real failures even when the
  final prose is correct.
- The current-main baseline completed all 135 journeys across eight homes:
  75 passed and 60 failed. No shard failed its authenticated-home preflight.
- Exact phrasing is incidental when the reply preserves the tested meaning;
  exact effect counts, privacy boundaries, and schedule semantics are not.

## Verification

- Commands to run: focused runner Vitest, deterministic filtered live-fixture
  tests, package typecheck, selected `pnpm test:assistant:live` journeys, then
  the full 112-journey pinned subscription suite.
- Completed deterministic proof: runner tests 9/9, fixture/harness tests 22/22
  with 135 live journeys skipped, and assistant-engine typecheck.
- Focused live proof: direct workout-card success and bounded card recovery pass;
  semantic usage/support matchers no longer fail before the suite reaches real
  duplicate-call, privacy, expiry, scope-selection, or clarification defects.
- Expected remaining outcome: harness and matcher false failures pass; genuine
  product failures remain visible and are not converted to passes by weaker
  checks.
Completed: 2026-08-28
