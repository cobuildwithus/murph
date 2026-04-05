# Hosted Queue Metadata Hard Cut

## Goal

Hard-cut the greenfield hosted Durable Object queue so durable runner metadata no longer persists plaintext operator details or legacy storage-crypto fallback behavior.

## Scope

- Remove the `apps/cloudflare/src/crypto.ts` compatibility branch that decrypts no-scope envelopes by retrying without AAD.
- Minimize Durable Object queue persistence in `apps/cloudflare/src/user-runner/**` so runner metadata keeps only durable fields needed for scheduling and coordination, not persisted plaintext last-error summaries or run/timeline payloads.
- Update focused hosted execution contracts/tests to match the greenfield status surface.

## Invariants

- Queue correctness still depends on exact pending, consumed, and poisoned event tracking.
- Hosted dispatch/storage reads must fail closed on AAD or scope mismatches.
- Operator-facing status should remain useful, but greenfield hard cuts may drop previously persisted detail rather than preserve it via migrations or shims.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused Cloudflare tests as an iteration aid before the full repo checks.
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
