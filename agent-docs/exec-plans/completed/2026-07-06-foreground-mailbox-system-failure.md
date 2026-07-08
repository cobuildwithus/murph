Goal (incl. success criteria):
- Ensure foreground hosted-runtime conversation imports cannot be preempted by failing system-lane mailbox items.
- Success is regressions where same-wake system items would fail import but conversation items still import and stage promptly in both the active foreground loop and post-checkpoint mailbox wake path.

Constraints/Assumptions:
- Preserve foreground reply priority over browser-vault refresh, device sync, maintenance, and idle checkpoint work.
- Keep mailbox watermarks and checkpoint ownership in the runtime import/checkpoint boundary.
- Do not add schedulers, queues, persisted state, or broad retry machinery.
- Preserve unrelated active hosted-runtime and group work.

Key decisions:
- Match the initial foreground import shape: import conversation first, then import system only as fallback when no conversation work was observed.

State:
- Complete; ready for archive/commit.

Done:
- Completion deep-review found that a system-lane exception could still abort a combined active foreground import before conversation staging.
- Active foreground import now runs conversation first and system fallback second.
- Completion re-audit found the same combined-import shape in the post-checkpoint wake path.
- Post-checkpoint mailbox wake now runs conversation first and system fallback second.
- Regression tests cover pending system churn, same-wake active system failure, and same-wake post-checkpoint system failure.
- Verification passed: focused regressions, full `hosted-runtime-workspace-entrypoint` suite, `hosted-runtime-workspace-runner` suite, assistant-runtime typecheck, and `scripts/workspace-verify.sh test:diff`.
- Final coverage, security/privacy, and deep-review re-audits found no medium-or-higher findings.

Now:
- Archive plan and commit scoped runtime/test changes.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts`
Status: completed
Updated: 2026-07-06
Completed: 2026-07-06
