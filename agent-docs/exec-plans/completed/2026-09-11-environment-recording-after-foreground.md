# Finish interrupted Environment recording after foreground work

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

Finish an Environment update after fresh foreground work interrupts its checkpoint,
while preserving immediate replies, vault-share delivery and durable completion.

Product UX effort: Patch. Outcome: the saved report finishes updating after the
foreground reply. Reaches: a member whose pending Environment update is restored
by a replacement runtime, including share failure and another incoming message.
Proof: real snapshot restore, actual foreground delivery, durable handled prefix
and the saved Habitat indicator in the published Browser Vault replica.

## Success criteria

- Reproduce the actual interruption through the existing runtime and system-work owners.
- Prove the smallest correction preserves real projection failures and retry authority.
- Pass focused tests, runtime typecheck, owner-doc checks and exact-head CI/review.
- Keep managed release admission distinct from local proof; require the affected hosted journey before calling the rollout complete.

## Scope

- In scope: interrupted system-work completion and its existing durable-effect/projection boundary; regression proof and current owner documentation.
- Out of scope: new state, queues, schedulers, retry policies, relaxed completion assertions, timeout increases or unrelated cleanup.

## Constraints

- Preserve foreground priority, committed mailbox prefixes and real vault-share-before-acknowledgment requirements.
- Keep existing canonical state and retry owners; no new persisted fields or dependencies.
- Preserve completed historical plans and unrelated worktrees. Use synthetic fixtures and aggregate operational evidence only.

## Risks and mitigations

1. Mistaking an absent projection result for a proven projection failure.
   Mitigation: observe the actual callback context and retained recording state in a composed regression before editing production logic.
2. Removing a necessary delivery barrier while avoiding a false retry.
   Mitigation: cover interruption, successful projection, actual projection failure and recovery through the existing owners.
3. Inferring a stuck scheduler from a later test-summary timestamp.
   Mitigation: correlate the case duration with successful activity timing; do not use final report emission time as the failure instant.

## Tasks

1. Complete source and managed-failure triage; reproduce the causal boundary locally.
2. Apply the smallest proven correction and run affected regression/type checks.
3. Review the full diff, update durable owners and changelog evidence, close this plan, commit and open a PR.
4. Run ReviewGPT alongside CI, disposition findings, merge when eligible and resume the managed release.

## Decisions

- The normal Environment completion scenario passes after the earlier publication reorder; the interrupted-owner scenario still leaves its system item unhandled.
- Successful Temporal activities rule out a simple stopped-scheduler explanation.
- A two-invocation regression now reproduces the completion failure: a real Environment recording is checkpointed, its system owner is stopped, and a fresh default runtime restores the snapshot and sends the foreground reply. The retained recording then gets `HOSTED_VAULT_SHARE_PROJECTION_FAILED` and a 60-second retry without any projection-scope read. No phase-internal wake injection or synthetic progress flags are used. This proves the runtime defect; the managed journey must still validate the final correction.
- The existing user authorization covers completion fixes, merge and rollout. Phone deletion and schema contraction retain their previously established deployment and drain prerequisites.
- The causal path is the main post-checkpoint drain, not the clean-return drain: a due mailbox wake requested owner handoff despite pending durable effects, which suppressed projection while still running those effects. The approved correction uses the existing pending/ready effect arrays to retain that completion owner. It adds no state or projection metadata.

## Verification

- Red: the composed replacement regression fails with one retained recording, the projection-failure code, a future retry and no projection-scope read or replica publication.
- Initial green: the same regression passes after the two handoff conditions; the foreground reply, handled prefix and actual Habitat replica all complete.
- Green: all three real-owner cases pass in 67.62 seconds, including the actual 60-second failure retry and fresh-foreground preemption. Eight selected existing runtime regressions pass across five files. Runtime typecheck passes.
- Green: docs drift and whitespace checks pass; complexity debt remains 546 with maximum 252 and 21 unchanged existing hotspots. Parent inspection confirms two production conditions, existing state ownership and synthetic fixture privacy.
- Product UX: Ready for this patch boundary. The actual foreground replies, durable handled prefix and published Habitat are proved through composed owners; model/control transport remains synthetic. No autonomous Temporal or production success is claimed.
- Green: all 10 focused changelog rendering tests pass; the production archive reference returns HTTP 200 and contains its documented anchor.
- Changelog: PR #3277 is associated with the existing Environment recovery item; its public copy and presentation remain unchanged.
- Pending: exact-head PR CI and ReviewGPT; then the unchanged managed foreground-priority journey and release pipeline.
Completed: 2026-09-11
