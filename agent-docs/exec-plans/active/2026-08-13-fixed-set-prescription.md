# Reuse exact active-workout set prescriptions

Status: active
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- When a member gives one exact repetition count for every set of an exercise
  in the active workout, Murph reuses that prescription for later unqualified
  set-completion messages instead of asking again or storing an incomplete set.

## Success criteria

- Prompt guidance distinguishes an exact member-stated active-workout
  prescription from an inferred target or a previous-workout value.
- Later `set N done` messages apply the exact active prescription, while
  explicit deviations, ranges, AMRAP, and conflicting prescriptions remain
  safe and unambiguous.
- Focused regression tests and a direct sequential conversation prove the
  fixed value is recorded on the canonical completed set.
- Required prompt/product/coverage review and exact-head CI pass before merge.

## Scope

- In scope: tracked-table workout prompt semantics, focused prompt regression
  coverage, direct behavior proof, and member-visible changelog classification.
- Out of scope: workout schema changes, cross-session prescription persistence,
  historical target inference, and broad workout-planning redesign.

## Constraints

- Technical constraints: keep actual completed-set fields distinct from saved
  plans; reuse only an exact prescription explicitly established in the active
  workout conversation.
- Product/process constraints: do not copy private feedback text into source or
  PR artifacts; use synthetic regression language and the prompt-primary PR
  workflow.

## Risks and mitigations

1. Risk: Murph could silently apply an ambiguous or stale target.
   Mitigation: allow reuse only for one exact active-workout prescription and
   require clarification for ranges, AMRAP, conflicts, or explicit deviations.
2. Risk: a prompt-only assertion could pass string tests without changing real
   behavior.
   Mitigation: run the production-model sequential conversation and inspect the
   canonical workout record in addition to focused tests.

## Tasks

1. Inspect the current tracked-table guidance, prompt assembly, and focused
   tests on current main.
2. Add the smallest non-conflicting active-prescription rule and regression
   coverage.
3. Run focused tests, typecheck, and direct sequential behavior proof.
4. Commit and push a candidate, open the PR, and run required ReviewGPT and CI.
5. Resolve findings, close this plan through `scripts/finish-task`, merge, and
   retire the worktree.

## Decisions

- Keep the fix prompt-primary. The active conversation already retains the
  exact prescription; no new persisted state or schema is needed for the
  reported same-conversation behavior.

## Verification

- Commands to run: focused assistant-engine Vitest files, package typecheck,
  prompt assembly checks, direct sequential model reproduction, exact-head CI,
  preliminary `completion-specialists` ReviewGPT, and clean merge-tree proof.
- Expected outcomes: later unqualified set completions store the established
  exact repetitions without a repeat question; all routed checks and reviews
  pass on the final PR head.
