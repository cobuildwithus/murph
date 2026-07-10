# PR 475 Final Receipt Review Fixes

## Goal

Close the remaining proven PR #475 review gaps: keep foreground canonical-write receipt durability status-only, restore full workspace snapshots to idle shutdown, and bound pending receipt replay without adding another state owner or unsafe shared-artifact deletion.

## Constraints

- Preserve canonical-write durability across host aborts and cold restore.
- Retain the prior workspace snapshot ref during foreground receipt checkpoints.
- Keep runtime state dirty until an idle snapshot covers it.
- Preserve target-shard-only integration-ingest planning; production ID construction and migration own global conflict prevention.
- Keep the receipt-log format backward compatible and fail before uploading a receipt when the pending bound is reached.
- Do not delete shared content-addressed artifacts without an owner-scoped retention model.

## Plan

1. Remove canonical-runtime full snapshots from the foreground receipt checkpoint path and platform bridge.
2. Replay receipt logs into runtime dirty domains on restore while preserving status checkpoint CAS progression.
3. Add and test a small hard bound on pending receipt-log entries and serialized log size.
4. Update hosted-runtime protocol and architecture documentation.
5. Run focused tests, workspace verification, typecheck, smoke tests, final review, and the PR review loop.

## Verification

- Focused assistant-runtime, core, and Cloudflare tests for touched behavior.
- `scripts/workspace-verify.sh test:diff <changed paths>`
- `pnpm typecheck`
- `pnpm test:smoke`
- `git diff --check`

## State

Active. Implementation includes saturated-log recovery through the existing
mailbox-continuation checkpoint contract followed by a status-only restoration
of the prior wake. The recovery snapshot retains the receipt-log pointer and
original prior wake until that reset succeeds, making the inter-checkpoint
failure window replayable without replacing the wake on retry.
The implementation also includes pre-upload capacity validation and full-batch payload
validation before sequential upload. The previous unbounded
v1 writer exists only on this unmerged branch, so strict over-limit restore
rejection has no deployed legacy state to migrate. Reference-safe receipt
artifact garbage collection remains out of scope because the runtime artifact
port has no owner-scoped deletion contract. The two receipt-log pointer fields
and three recovery-marker fields are reserved outside the ordinary 96-field
redacted-status budget at transport and persistence boundaries, preventing a
valid status from rejecting its first receipt or becoming unrecoverable at
saturation. Final verification and review are in progress.
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
