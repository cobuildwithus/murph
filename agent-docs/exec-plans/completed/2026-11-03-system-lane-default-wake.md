# Avoid false runtime-progress alerts during intentional pauses

Status: completed
Created: 2026-11-03
Updated: 2026-11-03
Completed: 2026-11-03

## Goal and scope

- Exclude imported default-owned system heads while the canonical usage gate
  proves an intentional allowance pause. Keep model-free heads alertable.
- Apply the existing bounded foreground-checkpoint exemption to meal-photo heads.
- Local commit only; the parent owns review and release. Billing, scheduling,
  production mutations, publication, and shared-checkout changes are out of scope.
- The parent explicitly requested this completed-record update in round two.

## Investigation evidence and decisions

- Root cause: operator meal-name repair consumed member allowance and exhausted
  it. The resulting usage denial blocked model admission until an Ops usage
  reset. The parent independently verified this cause.
- Accepted checkpoints retained the due default-processing wake throughout
  intervening system-mailbox invocations. Native runtime diagnostics confirmed
  assistant execution was blocked. There was no demonstrated wake overwrite.
- The runner retains retryable member actions and independently projects their
  assistant wake. Web persists that projection separately from the generic wake;
  reconciliation returns the usage denial without consuming the pending work.
- The initial synthetic wake-retention coverage passed the existing scheduler.
  Remove those coverage-only additions from the final diff; retain this evidence.
- The monitor's notification-only restriction misclassified a default-owned
  member action behind the same usage gate as a stall. Use the existing shared
  execution classifier for all system heads, including its default for new kinds.
- Meal photos were omitted from both the foreground-evidence SQL lookup and its
  classifier. Add the kind to both existing allowlists.

## Guards and regression proof

- Usage-pause exclusion still requires a stalled system head with a dedupe key,
  default-owned execution, and import coverage through aged high water without
  exceeding durable high water. Fresh suffix rows retain their own age.
- Only a successful read of `ai_usage_limit_exceeded` suppresses the alert.
  Read failures, other denial reasons, and the per-scan serial read budget keep
  normal alerting. No allowance, acknowledgement, or execution state is mutated.
- Meal-photo deferral retains current owner/lease matching, terminal foreground
  evidence newer than the saved workspace, valid chronology, import coverage,
  and the existing checkpoint publication deadline. Expiry restores original age.
  Foreground-checkpoint fixtures keep usage allowed with synthetic credit so the
  usage-pause exemption cannot mask their deadline and evidence assertions.
- Against `origin/main` at `5fd535892b`, four targeted cases failed: member-action
  usage pause and meal-photo foreground deferral, each in unit and real PostgreSQL
  tests. The member-action failure reported one stall instead of one intentional
  pause. Regression proof also checks model-free heads under the same denial and
  restored alerting when allowance returns. All four targeted cases passed after
  the changes, including the foreground fixtures with explicitly allowed usage.

## Final verification

- Both alert-monitor suites passed: 68 tests with
  `MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-runtime-progress-alert-monitor.test.ts apps/web/test/hosted-runtime-progress-alert-monitor-postgres.test.ts`.
  `DATABASE_URL` selected a newly created, migrated, isolated loopback database,
  removed after verification.
- `pnpm --dir apps/web typecheck`, `pnpm complexity:diff`, `pnpm docs:drift`,
  and `git diff --check` passed. Complexity maximum remained 16 with no hotspots
  above 20. Privacy readback found no direct identifiers or private row contents.
- Initial investigation verification passed 163 Web tests, 112 runtime tests,
  the runtime build, and both package typechecks. Those results are historical;
  the final candidate changes only the monitor, its regression tests, and docs.
- Real-model verification is not applicable: no prompts, tools, reply policy,
  model selection, execution routing, or assistant output changed.

## Review and release

- Reuse the existing bounded monitor query, shared execution classifier, and
  allowance reader. No schema, dependency, wire field, scheduler, state owner,
  retry policy, or foreground operation is added. No obsolete code remains to
  delete; the two unrelated coverage additions were removed.
- Internal-only alert classification: no public changelog entry. Product UX:
  Ready within the existing intentional-pause and checkpoint contracts.
- Web-only deployment is sufficient. Old and new runners use unchanged evidence;
  no runner deployment dependency or new skew window is introduced.

## Follow-ups

- Operator meal-name repair billing attribution: explicitly deferred by the owner.
- Repeated system-mailbox polling every ten minutes while usage is denied.
- Two initial meal-photo passes skipped handling before later progress. Their
  admission cause remains unexplained; the checkpoint alert fix does not claim
  to resolve that delay.
