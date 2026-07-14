# PR #605 ReviewGPT recovery

Goal (incl. success criteria):
- Finish the saved PR #605 remediation patch for causal Family usage attribution.
- Resolve all accepted exact-head ReviewGPT findings without weakening hosted access, billing, retry, privacy, or rollout invariants.
- Success means the PR-specific patch is preserved across current `main`, focused verification and required audits pass, exact-head ReviewGPT reports no accepted findings, and required CI is green or any remaining failure is concretely proven unrelated.

Constraints/Assumptions:
- Preserve the recovery worktree's 38 modified files and two untracked files in place; do not reset, discard, duplicate, or move them.
- Do not touch PR #542 or PR #573, and do not merge PR #605.
- Web remains the billing and usage-gate authority; Temporal and Cloudflare carry causal admission proof without becoming billing authorities.
- Cross-plane rollout must be additive and rollback-safe.
- Family billing-period history is immutable, bounded, and fail-closed on conflicting evidence.

Key decisions:
- Treat ReviewGPT round 2's five findings as the authoritative remediation scope.
- Use the existing deploy flag for the additive protocol transition and keep old/new payload shapes parseable during rollout.
- Bind attribution to each accepted runtime turn rather than mutable process-global state.
- Keep historical repair bounded and outside the current usage-record transaction.

State:
- All accepted local remediation and specialist-audit findings are resolved; verification is complete enough to close the recovery commit before current-main reconciliation.

Done:
- Confirmed local and remote PR head at `dc830bb57103b38a86e2fb7c30ec4862a9330508`.
- Confirmed all 40 saved worktree entries remain unstaged and no Git operation is in progress.
- Recovered ReviewGPT round 2's five blocking findings and inspected current failing leaf CI jobs.
- Identified five dirty files also changed on current `main`.
- Preserved causal attribution across active runtimes by binding the first accepted mailbox-input set to its admission attribution and mailbox high-water.
- Bounded mailbox imports to the causal admission horizon and kept coalesced attribution/high-water pairs inseparable.
- Made direct-period accounting use the admitted period, made Family history immutable, and bounded stalled repair retries.
- Added a web-only, member-bound HMAC proof for Family/direct attribution; supplied proofs are verified before accounting, and omission is rejected after rollout cutover.
- Completed the required coverage-write audit with four narrow proof additions.
- Completed the required security/privacy review loop with zero remaining validated medium-or-higher findings.
- Passed focused affected tests and typechecks. The full `pnpm test:diff` lane passed all guards and affected typechecks, then hit four untouched 60-second test timeouts under concurrent package load; all four exact targets passed in isolated reruns.
- Refreshed remote state: PR head remains `dc830bb57103b38a86e2fb7c30ec4862a9330508`; current `origin/main` is `ba8fe5446f169044dea5e4ed1aaeaf86a31beeb0`.

Now:
- Close the scoped recovery commit with the repository finish workflow.

Next:
- Reconcile current `main`, prove patch preservation, and push with an exact remote-head guard.
- Start exact-head ReviewGPT concurrently with CI and resolve every accepted finding.

Open questions (UNCONFIRMED if needed):
- Whether current-main reconciliation requires semantic conflict resolution in any of the five overlapping files.

Working set (files/ids/commands):
- PR #605 and branch `codex/family-usage-attribution-retry`
- `apps/web/src/lib/hosted-execution/usage-allowance.ts`
- `apps/web/src/lib/hosted-onboarding/family-plan.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-event-reconciliation.ts`
- `apps/web/src/lib/hosted-orchestration/runtime-reconciliation-facts.ts`
- `apps/cloudflare/src/{container-entrypoint,hosted-workspace-invocation,runner-container}.ts`
- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/hosted-execution/src/**`
- matching focused tests, migration, and durable deployment/architecture docs

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
