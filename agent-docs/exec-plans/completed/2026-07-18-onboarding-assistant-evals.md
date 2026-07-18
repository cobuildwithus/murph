# Onboarding assistant eval primitives

Status: completed
Created: 2026-07-18
Updated: 2026-07-18

## Goal

- Add the smallest reusable assistant-eval boundary needed to run onboarding
  conversations, preserve reproducible evidence, and let GPT Pro grade the
  resulting transcript against the current onboarding product contract.

## Success criteria

- One composable package owns scenario definitions, target execution, result
  artifacts, and grader input without introducing product state or a second
  assistant runtime.
- A high-signal onboarding scenario set exercises aspiration capture, explicit
  parking, progressive foundation, the contextual thread-choice gate, overall
  decline completion, privacy, and immediate-need precedence.
- Deterministic tests prove contracts, failure behavior, redaction-safe local
  artifacts, CLI discoverability, and onboarding registry wiring.
- A real onboarding eval run completes locally and its bounded artifacts are
  graded by GPT Pro through ReviewGPT.
- Required verification, coverage audit, parent final review, PR CI, and the
  exact-head ReviewGPT gate complete with no unresolved accepted findings.

## Scope

- In scope: a workspace-private eval package, its root workspace/test/typecheck
  wiring, onboarding scenarios and rubric, focused docs, tests, and ReviewGPT
  grading workflow.
- Out of scope: production assistant behavior, onboarding lifecycle/state,
  hosted runtime or deployment changes, provider credentials, production user
  data, and a general-purpose eval platform beyond current demonstrated needs.

## Constraints

- Treat the supplied patch as behavioral intent, not overwrite authority.
- Prefer deletion and explicit composition; add no database, service, daemon,
  queue, registry framework, plugin system, or dependency without a current
  failing requirement.
- Keep eval artifacts local, bounded, schema-versioned, gitignored, and free of
  secrets or direct personal identifiers.
- Reuse the production assistant boundary rather than implementing another
  assistant lifecycle or provider adapter.

## Tasks

1. Audit the patch against current repo owners and reduce it to the smallest
   durable primitive set.
2. Land package/root wiring and deterministic contract/runner/CLI tests.
3. Add onboarding scenarios and a product-spec-derived grader rubric.
4. Run focused and repo-required verification plus the coverage audit; resolve
   accepted findings and perform the parent final review.
5. Close the plan with a scoped commit, push, open the PR, run onboarding evals
   and GPT Pro grading, then run PR CI and ReviewGPT concurrently to PASS.

## Verification

- During implementation: focused package tests/typecheck and CLI smoke.
- Final local lane: the truthful `pnpm test:diff` scope selected by current
  root/package wiring, direct onboarding eval scenario proof, `git diff --check`,
  and identifier/secret-safe artifact inspection.
- Completion: required `coverage-write`, parent final review, exact pushed-head
  ReviewGPT loop, green PR CI, and clean merge proof against current `main`.
Completed: 2026-07-18
