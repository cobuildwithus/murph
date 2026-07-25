# PR 857 Active Checkpoint Ownership Remediation

Status: completed
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Keep every checkpoint path inside an active hosted foreground pass anchored to the latest accepted durable workspace snapshot.

## Requirement-level retrospective

- The original requirement remains indivisible: a requested phone call may start only after its exact direct origin session is restart-safe, and the eventual result must return to that session without unsolicited delivery.
- The first direct-session durability correction published the missing session before provider work. The subsequent wake correction deliberately advanced only the outer committed workspace so invocation-local wake and status state stayed owned by the active pass.
- Round 6 proved that this split left the active checkpoint request session on the pass-start workspace. A later canonical metadata checkpoint could therefore advance the accepted version while restoring the old snapshot reference.
- The repeated mechanism is divergent ownership of the latest accepted workspace during a mid-pass durability boundary.
- Decision: continue this PR with an owner-boundary correction. Return the accepted direct-session checkpoint to the existing active checkpoint request session so it becomes the single source for later canonical checkpoints. Do not add a persisted owner, queue, state machine, reconciliation path, or compatibility layer.
- The existing outer runtime retains invocation-local wake/status ownership. The active checkpoint request session owns the latest accepted workspace and expected version for all runner-local checkpoint paths.

## Success criteria

- A direct session absent from the restored snapshot is published before provider execution.
- A canonical write after that publication uses the published snapshot reference and the next accepted version.
- Invocation-local projected wake and status state survive the mid-pass boundary.
- A crash before the ordinary dirty checkpoint restores the exact origin session, and the phone-call result is recorded on that session for the next attended turn.
- Focused tests, typechecks, canonical diff verification, acceptance, exact-head CI, and the authorized final ReviewGPT continuation pass.

## Scope

- In scope: the Runtime-owned direct-session checkpoint return contract, the active checkpoint request session, production-path regression coverage, and review/PR evidence.
- Out of scope: new durable state, queues, lifecycle machinery, compatibility paths, retry policy changes, provider protocol changes, or Web checkpoint-store semantics.

## Tasks

1. [x] Add a focused reproduction proving the stale snapshot-reference rollback.
2. [x] Advance the active checkpoint request session from the accepted direct-session checkpoint.
3. [x] Add crash/restore/result continuity coverage through the real owner paths.
4. [x] Preserve the projected-wake mutation proof and run required verification.
5. [x] Parent-review and package the verified remediation candidate for the post-plan PR gates.

## Verification

- Focused Assistant Runtime runner and workspace-entrypoint suites.
- Hosted-local phone-call result roundtrip scenario where applicable.
- Assistant Runtime and Cloudflare typechecks.
- Canonical `pnpm test:diff packages/assistant-runtime apps/cloudflare`.
- Canonical `pnpm verify:acceptance`.
- Exact-head GitHub CI and final ReviewGPT correction-verification are post-plan
  PR gates.

## Evidence

- The focused regression failed before the production correction because the
  later canonical checkpoint used a null snapshot reference.
- The focused runner and workspace-entrypoint suites pass after the correction,
  including the existing projected-wake preservation case.
- Assistant Runtime and Cloudflare typechecks pass.
- The hosted-local Retell call-result roundtrip passes.
- Canonical diff verification passes for Assistant Runtime and Cloudflare.
- Canonical acceptance passes, including the production Web build and all
  Cloudflare verification suites.
- Parent review confirmed the active request session adopts only the accepted
  workspace/version; no new persisted owner, queue, state machine,
  reconciliation path, or compatibility layer was added.

## Post-plan PR gates

- Push the exact remediation commit and update the PR evidence.
- Clear exact-head GitHub CI.
- Complete ReviewGPT correction-verification round 7.
Completed: 2026-07-23
