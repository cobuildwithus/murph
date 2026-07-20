# PR 803 ReviewGPT remediation

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Close ReviewGPT round-one's foreground-abort finding on PR 803 without
  widening process ownership beyond the command that spawned the child.
- Repair the two deterministic release-audit assertions exposed by the first
  PR head.

## Success criteria

- The first forwarded signal starts one bounded graceful-to-force teardown and
  repeated signals do not create competing cleanup paths.
- An interrupted child cannot report success after trapping the signal, and
  Unix SIGHUP drives the same E2E cleanup and exit semantics as SIGINT/SIGTERM.
- Focused real process-group proof, owner coverage, typecheck, PR CI, and the
  ReviewGPT remediation round pass on the exact pushed head.

## Scope

- Foreground command signal handling in the hosted-local harness.
- Hosted-local E2E interruption tracking and focused regression tests.
- The directly failing CLI release-script audit fixture and assertions.

## Constraints

- Keep teardown authority local to the exact child handle/process group started
  by the current invocation.
- Do not add a process manager, persistent PID registry, or host-wide discovery.
- Preserve unrelated active work in the overlapping hosted-local E2E plan.

## Verification

- Focused foreground and E2E Vitest suites, including a real detached group
  whose leader and descendant ignore SIGTERM.
- Hosted-local owner coverage, package typecheck, and the focused CLI release
  audit.
- Required `coverage-write` completion pass, exact-head PR CI, and ReviewGPT
  remediation review.

## State

- ReviewGPT round one found a real unbounded-abort and SIGHUP orphan path.
- The owner-local remediation and focused tests are implemented.
- Focused process/E2E tests, the real detached-group reproduction, the CLI
  release audit, package typechecks, hosted-local owner coverage, package
  boundary, and truthful `test:diff` verification are green.
- The required `coverage-write` pass found no actionable gaps. Publication,
  exact-head CI, and ReviewGPT remediation review remain.
Completed: 2026-07-20
