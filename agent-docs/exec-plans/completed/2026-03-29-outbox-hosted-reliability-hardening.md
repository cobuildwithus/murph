# Execution Plan: Outbox And Hosted Reliability Hardening

## Goal

Land the requested reliability fixes across the local assistant outbox, hosted execution outbox hydration, Cloudflare Durable Object queue recovery, and hosted key rotation support without widening into unrelated assistant or onboarding work.

## Scope

- `packages/cli/src/assistant/outbox.ts`
- targeted CLI assistant contracts/channel adapter/runtime tests
- `apps/web/src/lib/hosted-execution/{hydration.ts,outbox.ts}`
- targeted hosted execution hydration/outbox tests
- `apps/cloudflare/src/{crypto.ts,bundle-store.ts,execution-journal.ts,outbox-delivery-journal.ts}`
- `apps/cloudflare/src/user-runner/{runner-queue-store.ts,runner-bundle-sync.ts,runner-commit-recovery.ts}`
- targeted Cloudflare user-runner / crypto tests
- minimal architecture or follow-up doc updates only where the behavior change is durable and externally important

## Requested Behavior

1. Local assistant outbox status, drain, and intent queueing must tolerate malformed outbox files by quarantining bad files instead of throwing.
2. Local assistant delivery must stop treating post-send persistence failures as ordinary resend-safe retries; add delivery idempotency metadata plus a durable send-attempt state that supports reconciliation before any resend.
3. Hosted Durable Object queue reads must poison malformed pending rows instead of throwing, and malformed stored bundle refs must be cleared to `null` with a surfaced warning.
4. Hosted execution hydration must classify permanent corruption or mismatch cases so outbox rows fail terminally instead of retrying forever.
5. Hosted encrypted bundle and journal reads must support staged key rotation and opportunistically re-encrypt older ciphertext with the active key after a successful read.

## Constraints / Invariants

- Keep `assistant doctor` strict about corrupted outbox state even if runtime readers degrade gracefully.
- Do not revert or overwrite unrelated in-flight edits in overlapping CLI or hosted files.
- Preserve existing receipt, diagnostics, and hosted side-effect journal semantics unless the fix explicitly changes them.
- Keep hosted queue corruption handling lane-local; do not reshape broader user-runner scheduling semantics.

## Verification Plan

- Focused Vitest runs for CLI assistant robustness/observability, hosted execution hydration/outbox, and Cloudflare user-runner/crypto coverage.
- Full required repo verification after integration: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Required completion audits via spawned subagents: `simplify`, `test-coverage-audit`, `task-finish-review`.
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
