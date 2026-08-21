# Increase the hosted device-sync pass budget

Status: active
Created: 2026-08-21
Updated: 2026-08-21

## Goal

- Give model-free hosted device-sync work enough time to drain more queued jobs
  per admitted pass without lengthening shared Web/checkpoint request deadlines.
- Preserve prompt foreground preemption and the existing durable retry and
  checkpoint handoff added by PR #2106.

## Success criteria

- Explicit device-sync mailbox wakes and idle device reconciles both use a
  90-second pass budget.
- The shared hosted runtime commit timeout remains unchanged.
- Fresh foreground work and invocation aborts can still end device work before
  the pass budget expires.
- Focused tests, package typecheck, required ReviewGPT passes, exact-head CI,
  and current-base mergeability complete with no accepted finding unresolved.

## Scope

- The hosted assistant runtime's device-sync maintenance admission paths.
- Focused call-boundary tests and the durable hosted-runtime protocol.
- The existing related public changelog item.

## Constraints

- Do not add another scheduler, retry owner, environment variable, or persisted
  state seam.
- Do not change the 45-second shared Web/checkpoint request timeout.
- Keep device maintenance lazy-loaded from foreground runtime code.

## Tasks

1. [x] Trace the deployed timeout, foreground-yield, and checkpoint ownership
   boundaries on current `main` after PR #2106.
2. [x] Add one lightweight 90-second device-pass limit and apply it to both
   device entry paths.
3. [x] Add focused regression assertions and update the runtime protocol.
4. [ ] Commit and push an exact candidate, open the PR, and start required
   ReviewGPT passes concurrently with exact-head CI.
5. [ ] Resolve findings, complete parent review, close this plan through
   `scripts/finish-task`, and prove current-base mergeability.

## Verification log

- `pnpm --dir packages/assistant-runtime typecheck` passes.
- The three focused hosted runtime suites pass: 3 files and 317 tests.
- The full assistant-runtime suite passes: 90 files and 2,467 tests, with five
  intentionally skipped tests.
- The optional diff verifier repeated the same full owner-package pass, then
  was stopped at an unrelated shared-host app-slot wait. Before that wait it
  reported two existing workspace-boundary violations in untouched test files.
