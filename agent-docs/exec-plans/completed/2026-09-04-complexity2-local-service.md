# Consolidate local provider completion journaling

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Delete duplicated provider completion journaling in the local assistant service while preserving successful and terminal-failure behavior.

## Success criteria

- One completion journal sequence handles both provider outcomes without adding an owner or helper.
- Focused lifecycle tests, package typecheck, and complexity guard pass.
- Parent accepts the exact candidate; final ReviewGPT and required CI pass on the PR head.

## Scope

- In scope: accepted-input completion journaling inside runCurrentProviderRequest and direct regression evidence.
- Out of scope: prompts, tools, provider request construction, cancellation, delivery, no-reply policy, usage ownership, and persistence schemas.

## Constraints

- Preserve successful admission close before journaling, failure admission timing, journal record/update fallback differences, accepted-input aliases, and continuation selection.
- Internal behavior-preserving refactor: no changed member journey, UI, or provider input. Deterministic lifecycle evidence is authoritative; no model-dependent claim requires a live journey.
- Use the assigned isolated worktree, neutral commit metadata, parent candidate review, draft PR, then concurrent ReviewGPT and CI. Do not merge.

## Risks and mitigations

1. Moving common journaling could close failure admission early or change continuation metadata.
   Mitigation: preserve the success-only callback before the journal await; select the outcome-specific continuation explicitly and exercise success, failure, and live-steered failure.
2. Journal alias fallback changes could lose accepted inputs.
   Mitigation: retain distinct absent-journal and existing-journal fallback values and existing late-input/no-reply tests.

## Tasks

1. Inspect current owners and existing direct tests; confirm clean sanctioned checkout.
2. Consolidate duplicated completion mechanics and strengthen terminal continuation proof.
3. Run focused tests, typecheck, and before/after complexity measurement.
4. Review exact diff and privacy, archive plan with scoped commit, open draft PR, and obtain parent review.
5. After clearance, mark Ready and drive ReviewGPT concurrently with CI to completion.

## Decisions

- Parent approved bounded journal consolidation after read-only scoping at baseline b6454467652310f7abdd63676dab0f769c340ae8. No exact-path open PR overlap was reported.
- Existing lifecycle owners remain in place; no abstraction or dependency is added.

## Verification

- Commands: focused assistant-local-service live-input/failure/delivery/session tests; assistant-engine typecheck; complexity:diff against the pinned baseline; git diff --check.
- Expected outcomes: unchanged successful/failure completion, accepted-input binding, live steering, no-reply recovery, and held-group reconsideration; less source and lower aggregate complexity.

## Results

- Four focused lifecycle files exercised 99 tests: 98 passed initially; the added assertion incorrectly selected the final drain write instead of the completion write. Correcting that assertion to identify the exact completion update passed the focused rerun (1 passed, 27 skipped); production code required no correction.
- `pnpm --filter @murphai/assistant-engine typecheck` passed, including after the assertion correction.
- Complexity guard passed: runCurrentProviderRequest 63 to 55, file total 574 to 566, debt 154 to 146, unchanged maximum 131 and 129 functions. Production diff is 33 added and 59 deleted lines.
- Direct comparison preserves success-only admission closure before the journal await, terminal versus successful continuation, distinct record/update fallbacks, and subsequent drain/usage/resume/delivery ordering. Existing live-input tests cover missed-close handling and held-group reconsideration.
- `git diff --check` and authored-diff privacy inspection passed. Frog inventory inspected; no new repository friction required an entry.
- Parent review, draft PR publication, final ReviewGPT, and required CI remain downstream PR gates; completion status is tracked in the PR and owning session.
Completed: 2026-09-04
