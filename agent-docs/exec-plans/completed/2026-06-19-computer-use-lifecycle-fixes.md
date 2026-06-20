# Computer-use lifecycle review fixes

Status: completed
Created: 2026-06-19
Updated: 2026-06-19

## Goal

- Fix the accepted computer-use lifecycle review findings from merged PR #214
  while leaving the separate SSRF/network-boundary finding out of scope.

## Success criteria

- A post-attach browser-state persistence failure cannot leave a `running` row
  pointing at a deleted Kernel browser.
- Ambiguous post-commit errors from browser attach or replacement cannot delete
  a Kernel browser already owned by the database row.
- Login-checkpoint replacement recovery, expiry, and account deletion can clean
  up deterministic orphan replacement browsers for awaiting login handoffs.
- Resume from `awaiting_user` clears only the completed handoff it already
  proved and cannot clear a newer open handoff installed by a concurrent pause.
- Focused regression tests cover the three fixed failure modes.

## Scope

- In scope: `apps/web` hosted computer-use browser/run/handoff state
  transitions, cleanup predicates, and focused Vitest coverage.
- Out of scope: the browser network guard / SSRF boundary hardening called out
  as review finding #1.

## Constraints

- Technical constraints: preserve existing store/service ownership, keep
  persisted-state transitions guarded by compare-and-swap conditions, and avoid
  introducing speculative orchestration layers.
- Product/process constraints: keep secrets, live-view URLs, local user paths,
  and direct identifiers out of logs, fixtures, docs, and handoff text.

## Risks and mitigations

1. Risk: broad cleanup predicates could delete an active human handoff browser.
   Mitigation: scope deterministic cleanup to login handoffs with no attached
   Kernel session and use existing deterministic browser names.
2. Risk: resume CAS becomes too strict and strands valid completed handoffs.
   Mitigation: keep validation in the same transaction but only require the
   already-proven handoff id/reason/completed status.

## Tasks

1. Inspect current service/store/test coverage for the three findings.
2. Fix post-attach failure compensation and add a regression test.
3. Fix checkpoint replacement orphan cleanup/recovery and add regression tests.
4. Make resume transition a guarded handoff CAS and add race coverage.
5. Run required audits, verification, final review, and scoped commit.

## Decisions

- Use the existing deterministic Kernel browser name as the cleanup handle for
  interrupted checkpoint replacement instead of adding a new persisted state
  unless inspection proves it is insufficient.
- Treat browser attach/replace writes as ambiguous if they throw after the
  Kernel browser exists: re-read the run before deleting, preserve the browser
  when the row owns that session, and leave unknown ownership to stale cleanup
  instead of risking a dead database handle.

## Verification

- Passed: `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-execution-computer-use.test.ts`
  (92 tests).
- Passed: `pnpm --dir apps/web typecheck`.
- Passed: `pnpm test:diff apps/web/src/lib/computer-use/service.ts apps/web/src/lib/computer-use/store.ts apps/web/test/hosted-execution-computer-use.test.ts`
  including dependency policy, workspace boundaries, hosted guards, hosted-web
  lint, full hosted-web Vitest, dev smoke, and production build.
- Blocked outside scope: root `pnpm typecheck` fails in the
  `packages/assistantd` package graph with unresolved
  `@murphai/operator-config/*` and related subpaths; this task changed only
  `apps/web` computer-use service/store/tests plus plan/ledger.
- Audits: security/privacy found no medium-or-higher findings; coverage-write
  found no missing proof; deep review found one ambiguous commit edge, which was
  fixed and then re-reviewed with no remaining issues.
Completed: 2026-06-19
