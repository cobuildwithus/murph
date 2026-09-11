# Restore hosted Environment completion and publication

Status: active
Created: 2026-09-11
Updated: 2026-09-11

## Goal

- A completed Environment interview reaches durable mailbox completion and publishes its updated Habitat data to Browser Vault while preserving prompt foreground replies.

## Success criteria

- Reproduce the remaining hosted failure at its owning boundary before changing production behavior.
- Preserve foreground ordering, checkpoint durability, projection failure recovery, and the browser publication assertion.
- Pass focused regression tests, affected typechecks, and required PR checks; rerun the complete managed priority proof before claiming production admission.

## Scope

- In scope: Environment completion, checkpoint effects, Browser Vault publication, and the existing runtime continuation that owns interrupted work.
- Out of scope: weakening admission, increasing timeouts without causal evidence, unrelated cleanup, or changing canonical data ownership.

## Constraints

- Reuse existing workspace, mailbox, projection, and scheduler owners. Add no persistence or retry layer without a demonstrated need.
- Work in the isolated task checkout; preserve other sessions' changes. Keep fixture and production diagnostics free of private data.
- ReviewGPT runs concurrently with CI under the user's established merge authorization. Production deployment still requires managed admission.

## Product UX

- Outcome: completed Environment answers appear in the member's existing Habitat view.
- Reaches: ordinary completion, concurrent foreground messages, and interrupted completion with retry; current failure handling remains truthful.
- Proof: canonical Habitat readback, ordered handled watermark, actual published replica content, and unchanged foreground provider-call limits. Hold until the composed path passes.

## Risks and mitigations

1. A handled mailbox item could conceal a missing browser publication. Keep independent canonical, handled-watermark, and published-content evidence.
2. Interruption could accidentally acknowledge a failed projection. Retain recording/retry behavior for actual failures and prove the handoff boundary.
3. A shared test scenario can contaminate later health assertions. Identify its offending state before making a separate product change.

## Tasks

1. Done: traced the failed composed cases and reproduced the checkpoint timing and future-continuation owner-release boundaries.
2. Done: preserve the existing quiet window for a no-progress projection correction and always send the existing exact-fence callback. Updated the existing owners and related changelog item.
3. Run focused verification and parent review, then open the PR and start ReviewGPT with CI.
4. Merge through normal protections and verify the managed hosted proof and deployment.

## Decisions

- The full Browser Vault reference comparison observes fresh Web state and remains valid with sharded storage.
- The existing quiesce fix addresses a separately reproduced race. The remaining composed failures do not justify reverting it.
- The operator health assertion alone does not establish a separate provider or alert implementation defect.

## Verification

- Focused runtime Environment completion tests using the existing workspace harness, plus affected owner tests and typechecks after the correction is known.
- Complete hosted foreground-priority proof in managed admission, preserving original assertions and foreground timing limits.

## Candidate evidence and remaining release work

- The timing regression produced checkpoint times of 180/180/360 seconds before the fix and 180/180/180 seconds afterward. An active quiet window still lasts 180 seconds; an actual progressing foreground pass still starts its full next window.
- The future Environment recording regression previously cleared the write fence without making the release callback. The corrected path sends one signed, bodyless, exact-attempt callback after clearing that fence, with the existing two-second cap and no retry or local alarm. Web still decides whether work is actionable.
- The three focused runtime files pass 21 cases, including actual Habitat indicator and note readback from the constructed Browser Vault replica. The Cloudflare coordination suite passes all 175 cases. Both affected typechecks pass.
- Complete hosted priority admission has not yet passed. Its original timeouts, browser publication checks, and foreground-provider limits remain unchanged; the diagnostic query now reports only typed wait reasons and timestamps.
- The private scheduler companion must separate a live owner horizon from the existing no-progress backoff. Public focused proof does not establish deployed Temporal timing.
- Managed admission, exact Web promotion and ordinary drain, compatible scheduler deployment, and Worker/container convergence remain release-owner follow-up. This candidate alone does not claim production rollout or authorize a rollback.
