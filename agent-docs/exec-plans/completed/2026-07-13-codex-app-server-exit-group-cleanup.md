# Codex app-server exit group cleanup

Status: completed
Created: 2026-07-13
Updated: 2026-07-13

## Goal

Prevent an unexpected Codex app-server leader exit from leaving an owned tool
descendant alive with inherited stdout or stderr handles, which can block the
leader `close` event, active-turn settlement, and warm-slot replacement.

## Success criteria

- A focused production-path regression fails before the fix because unexpected
  leader `exit` does not immediately signal the captured exact owned process
  group.
- Unexpected leader `exit` immediately requests exact process-group shutdown,
  without waiting for `close`.
- `handleClose` remains the single owner for draining already-written output and
  settling the active turn, and retains its existing idempotent shutdown signal.
- Abort-before-exit versus exit-before-abort precedence, startup-specialized
  errors, exact process ownership, and warm-slot replacement semantics remain
  covered and passing.
- Required local verification, completion audits, exact-head PR CI, and exactly
  one stable-head ReviewGPT 0.5.106 round complete successfully.

## Scope

- In scope: Codex App Server process exit/close lifecycle handling, exact owned
  process-group shutdown, focused assistant-engine lifecycle coverage, and the
  CLI facade assertion for the additional idempotent shutdown attempt.
- Out of scope: watchdogs, queues, second lifecycle managers, new ownership
  abstractions, unrelated Codex supervision, and deployment changes.

## Constraints

- Signal only the exact detached process group captured from a child started by
  this runtime; never inspect or signal ambient processes.
- Preserve `handleClose` as the only output-drain and turn-settlement owner.
- Prove the finding with a failing regression before production code changes.
- Preserve every unrelated checkout and ledger change.

## Risks and mitigations

1. Risk: moving settlement or output handling into `exit` could drop buffered
   output or change error precedence.
   Mitigation: request only the idempotent exact group shutdown from `exit` and
   leave settlement in `handleClose`.
2. Risk: a broader kill path could target an unowned process.
   Mitigation: reuse the existing captured process-group identity and existing
   shutdown primitive; add no discovery or name-matched signaling.

## Tasks

1. Trace the merged production call path and existing lifecycle/group-shutdown
   tests.
2. Add and run a focused failing regression for exit-before-close with a
   descendant-held pipe.
3. Implement the smallest exit-ordering correction and rerun focused lifecycle
   tests.
4. Run affected diff verification, full required acceptance, direct scenario
   proof, security/privacy review, coverage-write review, and parent final
   review; resolve only proven findings.
5. Close the plan through `scripts/finish-task`, push the scoped commit, open the
   ready PR, and start exactly one ReviewGPT round concurrently with CI.
6. Prove the final pushed head is thread-clean, CI green, conflict-free, and
   merge-ready without merging it.

## Decisions

- Treat the finding as a hypothesis until the production call path and focused
  failing regression prove it.
- Use the existing exact process-group shutdown primitive on unexpected leader
  exit; do not add lifecycle state or timing machinery.
- Keep `handleClose` unchanged as the only output-drain and active-turn
  settlement owner. The `exit` listener only records the existing end reason
  and requests shutdown of the already-captured exact owned process group.
- Fold the focused regression into the existing abort/exit precedence matrix so
  the same six settlements prove cleanup occurs before `close` without adding a
  parallel lifecycle fixture.

## Verification

- Red proof: before the production change, the focused exit-before-close
  regression failed because no `process.kill(-40500, 'SIGKILL')` call occurred.
- Focused green proof: the six-case abort/exit settlement matrix passed; the
  broader startup, diagnostics, group-shutdown, and warm-replacement selection
  passed 19 tests; the full assistant Codex runtime file passed 175 tests; and
  the affected CLI facade test passed.
- Direct owned-process proof: a session-started detached leader with a
  descendant retaining its pipe delayed `close` by about 708 ms without the
  sweep, while signaling the captured exact process group on leader `exit`
  closed it in about 1 ms.
- `pnpm test:diff packages/assistant-engine/src/assistant-codex.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts packages/cli/test/assistant-codex.test.ts`
  passed all affected typechecks, guards, 4,966 package tests, and 1,736
  Cloudflare tests.
- Required security/privacy review reported no Critical, High, or Medium
  findings. Coverage-write review found no missing regression coverage, and the
  parent full-diff/call-path review found no remaining issue.
- Two default-concurrency `pnpm verify:acceptance` attempts each reached a
  different unchanged CLI test's 60-second timeout under parallel coverage
  load. Each timed-out test passed in isolation. The full acceptance contract
  then passed with repository-supported, coverage-preserving scheduling:
  `MURPH_ACCEPTANCE_APP_VERIFY_WITH_COVERAGE=0`,
  `MURPH_PACKAGE_COVERAGE_CONCURRENCY=2`,
  `MURPH_PACKAGE_COVERAGE_CLI_ACTIVE_CONCURRENCY=1`, and
  `MURPH_PACKAGE_COVERAGE_VITEST_MAX_WORKERS=2`. This completed package/app
  typechecks, all package coverage, package boundaries, web lint/build/dev
  smoke and 4,313 web tests, plus 1,736 Cloudflare tests.
- Exact-head GitHub CI, mergeability, unresolved-thread, and the single
  ReviewGPT round remain PR-head gates. They are recorded in the PR and final
  handoff rather than mutating the stable reviewed head after this plan closes.
Completed: 2026-07-13
