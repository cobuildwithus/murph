# Stop repeated background runtime wakes

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Stop empty background invocation loops by making completion state and wake projection converge across checkpoints and restores.

## Success criteria

- A synthetic regression fails on the unchanged implementation and passes after the correction.
- Repeated restores complete retained work or preserve its real future retry; they do not manufacture immediately due work.
- Foreground input still preempts background work, and interrupted work remains recoverable.
- Focused runtime tests, relevant typecheck, complexity review, and scoped commit complete.

## Scope and owners

The independent system-work completion checkpoint and existing foreground mailbox prefetch own the correction. Reuse their existing state and ports. No new scheduler, persistent store, production mutation, or provider request is authorized by this plan.

## Product UX

Outcome: restore reliable background progress without repeated empty processing.
Reaches: device imports, background completion recovery, and foreground conversations that interrupt them.
Proof: synthetic repeated-invocation tests with actual snapshot restore and existing foreground/retry regression suites.

## Investigation and implementation

1. Reproduce the failure through the composed runtime entrypoint before changing production source.
2. Identify the first inconsistent transition and correct its existing owner with the smallest maintainable change.
3. Prove ordinary completion, repeated background wakes, genuine foreground interruption, future retry, and restore convergence.
4. Review privacy, authority, deployment compatibility, and complexity; complete checks and commit.

## Risks and mitigations

- Dropped work: assert retained obligations survive interrupted snapshots and subsequent restore.
- Delayed foreground replies: preserve real conversation preemption and run focused priority coverage.
- Premature retries: assert the canonical future retry remains unchanged.
- Version skew: retain existing persisted schemas and callback contracts.

## Evidence

All fixtures and evidence below are synthetic.

- On unchanged base `e0b43e207c2f`, three runtime invocations each completed the device work locally but lost the completion snapshot to a default-owner nudge with no conversation input. The durable handled watermark remained `0` instead of `1`, with an immediately due wake; the test counted three interrupted completion snapshots and four accepted checkpoints.
- The correction checks the bounded conversation mailbox only when a wake interrupts the final independent-completion snapshot. Empty responses keep the snapshot running and re-arm the wake listener. A real conversation batch is retained for the existing foreground handoff.
- Recording and external acknowledgement remain immediately interruptible. The existing acknowledgement-interruption regression caught an overbroad first correction; the final implementation limits validation to the snapshot after recording finishes.
- The new regression passes across three real snapshot round-trips, advances handled-through to `1`, clears both returned and durable wakes, and fetches the device snapshot once. A second scenario first supplies an empty nudge, then a real conversation; it proves the listener re-arms, cancels the snapshot, and reaches the foreground phase.

## Verification and review

- `pnpm --filter @murphai/assistant-runtime test hosted-runtime-workspace-entrypoint-system-preemption.test.ts hosted-runtime-workspace-entrypoint-system-mailbox.test.ts hosted-runtime-concurrent-device-import.integration.test.ts --maxWorkers=1`: 74 tests in the mailbox/concurrent-import suites passed; the acknowledgement-cancellation test exposed the first correction's scope issue.
- After narrowing the correction, `pnpm --filter @murphai/assistant-runtime test hosted-runtime-workspace-entrypoint-system-preemption.test.ts --maxWorkers=1`: all 29 tests passed.
- `pnpm --dir packages/assistant-runtime exec vitest --watch --config vitest.config.ts --no-coverage test/hosted-runtime-background-wake-convergence.test.ts`: both new regressions passed on the final source. The session-owned watcher was exited after verification.
- `pnpm --filter @murphai/assistant-runtime typecheck`: passed.
- `pnpm complexity:diff`: passed; existing source complexity debt and maximum are unchanged. Parent review found no justified broader extraction of the large existing runtime owner.
- `git diff --check`: passed. Parent review checked cancellation, retained work, real foreground handoff, retry ownership, bounded reads, unchanged auth boundaries, and privacy.
- Product UX: Ready for local review. Existing foreground delivery and retained-retry journeys passed. The new foreground test intentionally stops at phase entry; the concurrent-import suite covers synthetic delivery through the provider seam. No model instructions or tool choices changed, so a real-Codex prompt journey does not apply.
- Changelog: not applicable. This is internal operational bookkeeping that avoids redundant requests after background work has already completed; no interface or new member capability is introduced.
- Frog: existing entries reviewed; no new repository-actionable tooling defect was introduced or worked around.

## Call, deployment, and completion boundaries

The normal foreground path gains no reads. During the final background-completion snapshot, each coalesced wake can cause one sequential bounded conversation-prefix fetch using the existing mailbox budget, transport timeout/retry policy, and runtime/shutdown cancellation signal. A confirmed batch is reused for handoff; empty checks do not create another immediately due assistant wake. No provider or database mutation is added by classification.

Persisted mailbox state, snapshots, callbacks, and wake schemas are unchanged. Old snapshots restore through the same owner; new completion snapshots remain readable by old code. Runtime rollout is sufficient, with no Web migration or ordering dependency. Reverting code is schema-compatible but can restore the loop.

The authorized local fix and parent review are complete. No branch push, PR, external ReviewGPT, CI, or production deployment was performed. Those remain release-stage checks; after deployment, compare bounded empty-import/checkpoint/request rates and confirm foreground delivery plus handled-through advancement on the deployed runtime version. Local reproduction proves this defect and its correction, not that every production request in the observed increase shares this cause.
Completed: 2026-09-10
