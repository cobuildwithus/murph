# Publish mailbox ownership after idle restore

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal and invariant

A restored runtime that owns retained device work must publish its exact continuation ownership even when its first pass imports nothing and makes no other changes. Ownership remains on existing system mailbox items; Web accepts only the existing exact checkpoint proof. No device jobs run early and no engagement block is bypassed.

## Evidence and owner

The deployed retention fix restores legacy continuation ownership, but an idle default pass can finish without checkpointing the newly derived projection. The existing restored-system-progress check covers only numeric frontiers and only system-mailbox processing. Extend that owner to recognize unpublished continuation membership and reuse it in the default idle-checkpoint decision.

## Scope and design

- Reuse the restored progress check and the normal fenced checkpoint/idle floor.
- Derive owners from existing bounded system mailbox state; add no persisted state, API, dependency, queue, or recovery identity.
- Preserve future retries, existing projection no-op behavior, and failure-closed checkpoint semantics.
- Keep production identifiers and row contents out of this plan and all artifacts. Production evidence is aggregate only.
- The existing legacy-shape compatibility remains removable once old retained pending shapes no longer restore; this change adds no additional migration state.

## Product UX

Effort: focused operational recovery. Affected journey: retained device work continues after a runtime upgrade, without user intervention or premature provider execution. Current ownership and empty idle workspaces retain existing no-op behavior. No new UI, messages, prompt input, or model action. Ready requires regression proof and live checkpoint/sweep recovery.

## Verification and delivery

1. Reproduce an idle restore with future retained work and an older checkpoint missing ownership; prove the test fails at base.
2. Extend existing progress publication, prove one checkpoint includes the exact owner, preserves the future wake, and a current checkpoint remains a no-op. Cover system-mailbox mode and checkpoint failure as applicable.
3. Run relevant entrypoint/mailbox regression tests, assistant-runtime typecheck, complexity and docs checks; parent review.
4. Push a follow-up PR, run required ReviewGPT concurrently with CI, then merge/deploy under existing task shipping authorization.
5. Web already accepts the ownership projection. Deploy runner through the protected immediate rollout, verify exact source/convergence, then canonical recovery. Any further Temporal mutation needs explicit current-task authorization for its exact operation; the three approved wakes have already been sent once each.

## Status

- Follow-up isolated checkout created from current main.
- Base reproduction: default idle restore with missing ownership produced no checkpoint; the identical already-published default case remained a no-op.
- Correction: the existing restored-progress helper now compares exact continuation membership; the default no-progress path reuses that helper and the ordinary idle checkpoint.
- Verification: scheduling, restore, and mailbox-state suites pass (90 tests); assistant-runtime typecheck and complexity pass. Complexity debt and maximum remain unchanged. The obsolete scalar progress import was removed.
- Parent review: no new state, payload, provider execution, DB call, schema, or public API. One bounded local mailbox-state read can run after a no-progress foreground pass; progressed passes short-circuit it. Existing checkpoint failure/fence rules apply. No first-provider-input changes for individual or group runtimes.
- Product UX: Ready for candidate review. Synthetic restore proves exact checkpoint ownership and unchanged future retry, including the current-checkpoint default no-op. Production verification remains pending protected delivery.
- ReviewGPT round 1: PASS, zero findings, REVIEW_COMPLETE on 01023a75873a72b16499d5d248fa9d83e7a861df. Verified full snapshot, gpt-6-pro model evidence, exact preceding user turn, and response SHA256 e04e3c1309ea058fc5fb8b8fd7df0fe32d331e3b4999d575100b3a4a6d189d30. No remediation required.
- Parent final review: implementation and local proof complete; no further source change required. Close this implementation plan before the final delivery gates. Final CI, merge, and protected rollout remain delivery work; no production recovery claim is made here.
Completed: 2026-09-04
