# Extract the hosted group tool context owner

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Give hosted group-tool authority and channel adaptation one concrete module
  owner, preserving every current request, response, and delivery boundary.

## Success criteria

- The factory and its private helpers live in `hosted-runtime/group-tool-context.ts`.
- Accepted-input loading and execution-context installation remain in the
  assistant phase; the extracted owner never imports that phase.
- Focused authority and composed-operation tests and package typecheck pass;
  the original session resolves the documented exact-move guard prerequisite
  before draft PR handoff and Ready admission.

## Scope

- In scope: the group-tool context factory, its helpers and shared Linq-service
  type, direct test imports, and this execution record.
- Out of scope: callback delivery, lifecycle coordination, prompt/schema changes,
  canonical state, deployments, and final PR review/Ready admission.

## Constraints

- Preserve current public route and context primitives, bounded sender evidence,
  email denial, provider capability results, and fail-closed ambiguity handling.
- Use only this assigned worktree; keep test concurrency at two workers or fewer.
- The original session owns final candidate review, ReviewGPT, and exact-head CI.

## Risks and mitigations

1. Main has advanced since the review. Compare the complete proposed cluster
   against the current base before moving it; retain current behavior.
2. Authority could be accidentally widened by a move. Preserve the existing
   direct factory tests and composed durable accepted-input operation tests.

## Tasks

1. Verify current factory, callers, shared types, and existing owners.
2. Move the coherent adapter cluster and redirect imports without compatibility
   wrappers or new state.
3. Run focused tests/coverage, package typecheck, complexity, and diff/privacy
   review; record applicability of real-model verification.
4. Archive the implementation plan with a scoped commit, push, and open a draft
   PR with complete evidence for the original session's completion review.

Implementation and scoped proof are complete. Push and draft PR creation remain
with this lane after the original session supplies the shared guard prerequisite;
final candidate review, CI, and ReviewGPT remain with the original session.

## Decisions

- The current base's 592-line extraction cluster exactly matches the reviewed
  cluster. Adjacent assistant-phase code has changed and stays in place.
- The extracted factory/helper bodies are byte-identical to the task base.
  After accounting for the planned import and block removal, the remaining
  assistant phase is byte-identical too. An independent read-only audit confirmed
  the new module has no phase dependency or stale caller.
- No persisted state or protocol changes; failure, retry, and rollout behavior
  remain owned by the existing runtime and Web boundaries.
- Live assistant proof is not applicable if the final diff remains a literal
  relocation: no interpretation, tool contract, availability, arguments, or
  response policy changes. Composed production-operation tests prove wiring.

## Verification

- Frozen dependency installation in this worktree, then `scripts/frog list`.
- Focused group-tool context and managed-automation Vitest suites, at most two
  workers, with direct coverage of the extracted module.
- Assistant-runtime typecheck and `pnpm complexity:diff` against the task base.
- Expected: unchanged authority/effect behavior and a narrow import boundary.
- Passed: frozen dependency installation and `scripts/frog list`; no task-owned
  Frog entry is needed beyond the shared guard prerequisite's entry.
- Passed: `pnpm --dir packages/assistant-runtime exec vitest run --config
  vitest.config.ts --isolate=true --no-coverage --maxWorkers=2
  test/hosted-runtime-group-tool-linq-context.test.ts
  test/hosted-runtime-workspace-assistant-phase-managed-automation.test.ts`:
  2 files, 70 tests.
- Passed: `pnpm --dir packages/assistant-runtime typecheck`.
- Passed: `pnpm --dir packages/assistant-runtime exec vitest run --config
  vitest.config.ts --isolate=true --maxWorkers=2 --coverage
  --coverage.include=src/hosted-runtime/group-tool-context.ts
  --coverage.reportsDirectory=../../.artifacts/group-tool-context/coverage
  test/hosted-runtime-group-tool-linq-context.test.ts`: 34 tests;
  statements/lines 93.23%, branches 90.86%, functions 93.75%.
- Passed: `git diff --check`, exact source-identity comparison, and independent
  read-only ownership/privacy review. Existing direct tests move only their
  import and retain all assertions; no model-call evidence is required for
  unchanged prompt, schema, tool, and reply behavior.
- The current per-file complexity guard treats the unchanged moved methods as
  new debt: the new module gains 31 while the phase loses exactly 31. The two
  moved hotspots remain `request` (44) and
  `buildHostedGroupEmailRestrictedActionUnavailable` (27). The original session
  owns a shared exact-move guard prerequisite and its Frog entry; this lane does
  not fragment domain functions or change the guard to satisfy that metric.
Completed: 2026-09-10
