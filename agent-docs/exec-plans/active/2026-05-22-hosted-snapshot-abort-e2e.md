# Hosted snapshot abort E2E

Status: active
Created: 2026-05-22
Updated: 2026-05-22

## Goal

- Prove that when a new inbound assistant message wakes the active hosted runtime while an idle v2 workspace snapshot is in progress, the stale snapshot is not published, its upload session is explicitly aborted, and the runtime foreground pass resumes before checkpointing.

## Success criteria

- The Cloudflare bridge re-checks the active checkpoint lease after direct R2 upload and before checkpoint publication.
- The Cloudflare child bridge converts a pending runtime wake into an explicit checkpoint interruption after direct R2 upload and before checkpoint publication.
- The assistant-runtime loop handles that interruption by running another foreground pass rather than failing the whole invocation.
- The Cloudflare runtime platform reuses the snapshot session's original write-fence headers for presign, complete, and abort after the live lease has moved on.
- A deterministic regression test simulates the lease changing during the upload window and asserts no stale checkpoint is published.
- The production runner outbound complete route retires/deletes a matching upload session when the active DO write fence has already moved on before publication.
- The regressions prove the active snapshot upload session is aborted, the uploaded object is removed from the test store, and failure logs stay metadata-only.
- Focused Cloudflare test/typecheck verification passes or any unrelated blocker is documented.

## Scope

- In scope: `apps/cloudflare` hosted workspace v2 snapshot bridge, child wake wiring, runtime platform snapshot port, runner outbound abort/complete routes, `packages/assistant-runtime` checkpoint interruption handling, and focused test coverage.
- Out of scope: live iMessage/Temporal production probing, broad hosted-local timing sleeps, R2 lifecycle changes, and unrelated web UI dirty work.

## Constraints

- Technical constraints: preserve the simple lease/write-fence model; do not introduce timing sleeps or live network dependencies in the test; keep diagnostics redacted and metadata-only.
- Product/process constraints: preserve unrelated working-tree edits and coordinate with overlapping active hosted artifact diagnostics work.

## Risks and mitigations

1. Risk: A sleep-based E2E would be flaky and slow.
   Mitigation: Use the bridge harness to invalidate the lease exactly after the direct upload hook.
2. Risk: Aborting after upload could delete a snapshot that was already checkpointed.
   Mitigation: Run the new lease check before the web checkpoint attempt and keep existing complete-route CAS/orphan safeguards intact.
3. Risk: A stale invocation may no longer own the current write fence when it needs to abort its own upload session.
   Mitigation: Bind abort cleanup to the stored upload session identity instead of current live lease ownership, validate live ownership immediately before complete publishes, and add route-level coverage.
4. Risk: A stale caller with mismatched headers could delete a different active upload session.
   Mitigation: Return 409 without retiring/deleting unless the request headers match the stored upload session identity, even when the stored session is expired.
5. Risk: The bridge could detect a stale lease but the production abort request could be sent with the newly-current lease rather than the snapshot session's original fence.
   Mitigation: Cache the session write-fence headers at snapshot-session start and reuse them for presign, complete, and abort; add platform-level coverage for abort/complete after the live lease changes.
6. Risk: A synthetic lease-generation flip would not match production, where runtime wakes are coalesced signals and the active write fence can remain unchanged.
   Mitigation: Use the pending runtime wake signal as the interruption source and add assistant-runtime coverage proving a checkpoint interruption reruns foreground mailbox import before checkpointing.

## Tasks

1. Inspect the current v2 snapshot lease/abort path.
2. Add the smallest lease check needed before checkpoint publication.
3. Add focused bridge, runtime-platform, and runner-outbound regression coverage for the in-flight snapshot abort.
4. Run focused Cloudflare verification and completion audits.
5. Commit the scoped result or report the blocker.

## Decisions

- Treat a text received during snapshot as a pending runtime wake. The deterministic test should simulate that production signal directly instead of depending on live messaging timing.

## Verification

- Commands to run: focused `apps/cloudflare` Vitest for the bridge test, `apps/cloudflare` typecheck or truthful scoped alternative, and whitespace/diff checks.
- Expected outcomes: regression passes, no raw snapshot ids/object keys appear in logs, and unrelated dirty web files are untouched.
