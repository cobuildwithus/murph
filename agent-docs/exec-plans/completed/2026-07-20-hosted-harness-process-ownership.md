# Hosted harness process ownership

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Port the necessary process-ownership correction recovered from an old dirty
  worktree onto current `main` and publish it as a fresh PR.
- Remove cleanup paths that can signal processes by command text, port
  ownership, stale lock metadata, or other heuristics instead of exact
  current-run ownership.

## Success criteria

- Ordinary hosted-local and web harness teardown signals only child handles or
  detached process groups created by the current run.
- Occupied ports, live locks, and prior-run process identities fail closed and
  tell the operator what must be stopped; they are never adopted as signal
  authority.
- Command-pattern `pkill` cleanup and prior-run Temporal force-reset behavior
  are deleted.
- Focused tests, owner coverage, typecheck, completion audits, PR CI, and the
  ReviewGPT loop pass on the exact pushed head.

## Scope

- Hosted-local process spawn, teardown, port admission, and reset behavior.
- Web dev/smoke lock ownership and foreground command process groups.
- Focused process-ownership tests and directly coupled package scripts.

## Constraints

- Never signal a process unless the current run started it and exact ownership
  is still proven.
- Do not add a process manager, daemon, command-pattern compatibility path, or
  broad persisted PID registry.
- Preserve unrelated active work and resolve current-main drift at the smallest
  owning boundary.

## Verification

- Focused Vitest suites for hosted-local process, runtime, stack, port
  admission, web dev/smoke, and verify-fast.
- Hosted-local owner coverage and package-boundary verification plus full
  workspace typecheck.
- Required `coverage-write` completion pass.
- Exact-head PR CI and ReviewGPT with zero accepted findings.

## State

- Recovered patch applied cleanly to a fresh worktree based on current `main`.
- Removed unfinished assistant/device-daemon scope that deleted current APIs
  without updating their callers or tests; that WIP remains recoverable in the
  source branch stash and is not part of this PR.
- Current-main harness mock alignment is complete. Full workspace typecheck,
  focused web and Cloudflare suites, hosted-local coverage (394 passed, one
  skipped), and the built package-boundary suite are green.
- The required test-only `coverage-write` audit completed with no edits or
  actionable proof gaps. Existing tests cover fail-closed admission, exact
  retained-child/group signaling, TERM-to-KILL escalation, and post-exit safety.
- Truthful `pnpm test:diff` verification is green for all three touched owners:
  hosted-local harness (394 passed, one skipped), hosted web (5,887 passed, 148
  skipped, live dev smoke, lint, and production build), and Cloudflare (1,842
  Node tests plus the Workers-runtime test).
- Parent final review, exact-head PR CI, and ReviewGPT remain.
Completed: 2026-07-20
