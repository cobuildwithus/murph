# Keep inbound hosted videos transient

Status: active
Created: 2026-08-23
Updated: 2026-08-23

## Goal

- Keep inbound video bytes transient in the hosted runtime: they may exist in
  the warm container only while an unresolved accepted input can still use
  them, must never enter a newly published encrypted workspace snapshot, and
  must be removed as soon as that input no longer needs them.

## Success criteria

- Snapshot archive planning excludes every ordinary stored inbox attachment
  classified as video while preserving the capture descriptor, transcript,
  and other structural recovery state. An explicit canonical durable raw
  reference remains the persistence exception.
- Hosted idle maintenance makes unprotected video bytes immediately eligible
  for the existing atomic inbox-media retention write instead of retaining
  them for the general 14-day image/audio window.
- Pending accepted input can protect a video only in the warm container; the
  raw bytes remain excluded from snapshots and disappear on container eviction
  even before local cleanup succeeds.
- Existing dormant hosted workspaces are re-armed through the existing bounded
  retention wake owner so their next checkpoint scrubs any previously
  persisted video and the existing snapshot-transition cleanup deletes the
  replaced encrypted object.
- Private-direct video analysis and ordinary non-video attachment handling keep
  their existing behavior.
- Focused tests, routed typechecks, exact-head CI, and required ReviewGPT gates
  pass.

## Scope

- In scope:
  - hosted inbox video attachment persistence and retention;
  - v2 hosted workspace archive planning;
  - existing retention-wake scheduling for dormant workspaces;
  - live architecture, security, reliability, deploy, and verification docs;
  - focused regression and migration tests.
- Out of scope:
  - image and audio retention;
  - provider-side Linq or Gemini retention policies;
  - generated response media and canonical user-saved captures;
  - a new queue, database table, object store, scheduler, or cleanup service.

## Constraints

- Technical constraints:
  - Web remains the durable workspace/wake owner; Cloudflare remains the
    execution and encrypted-snapshot adapter.
  - Reuse the canonical inbox retention transaction so tombstones and file
    deletion stay atomic.
  - Preserve accepted-work and foreground reply priority. A pending video may
    remain in the warm container briefly, but it must stay outside snapshots.
  - Avoid database fanout or per-member runtime scans outside the existing
    bounded retention dispatch.
- Product/process constraints:
  - Product UX Patch. Affected people are: a private-direct sender whose video
    is actively being processed, a sender whose turn fails or is abandoned, an
    existing dormant hosted member with an older snapshot, and senders of
    image/audio attachments whose behavior must not change.
  - No raw media, provider content, direct identifiers, paths, or message data
    in logs, docs, fixtures, plan evidence, or the PR body.
  - Use the isolated worktree/PR lane, close this plan with the task commit,
    and complete the required preliminary and final ReviewGPT gates.

## Product UX

- Effort: Patch.
- Outcome: A person can send a video for help without ordinary raw video bytes
  becoming durable hosted workspace state.
- Reaches: Existing private-direct video analysis, failed or abandoned hosted
  turns, dormant workspaces with older snapshots, and unchanged image/audio
  attachment journeys.
- Proof: Focused snapshot, idle-maintenance, inbox-retention, and re-arm tests
  prove the active, cleanup-failure-independent, non-video, explicit durable-ref,
  and existing-workspace paths.

Walkthrough result: Ready. A private-direct sender's accepted video remains
available to the current turn but absent from the next snapshot. A failed or
abandoned turn cannot make the video snapshot-durable, and warm-container
eviction removes local residue even if the best-effort cleanup has not run.
An existing dormant workspace is re-armed onto the current bounded retention
owner so its replacement snapshot omits ordinary video paths. Image/audio
senders retain their 14-day window, while an explicitly promoted canonical raw
reference retains its existing lifecycle. No rendered UI or outbound copy
changes, so screenshots add no evidence. This matches the plan; the abandoned
turn relies on snapshot exclusion plus container eviction rather than a new
timer.

## Risks and mitigations

1. Risk: deleting a video before the active turn has frozen or consumed it.
   Mitigation: reuse unresolved accepted-input protections while keeping those
   bytes outside snapshots; exercise initial and live-steered analysis paths in
   focused tests.
2. Risk: filtering by a filename or extension misses a provider-labeled video.
   Mitigation: derive excluded paths from the validated canonical inbox
   attachment kind and normalized stored path, not from extension guessing.
3. Risk: a cleanup failure republishes the same raw bytes.
   Mitigation: snapshot exclusion is independent of local deletion, so
   retention failure cannot copy the video into a new encrypted snapshot.
4. Risk: a broad re-arm creates database or runtime fanout.
   Mitigation: update only current workspace rows once, clear the existing
   signal-attempt marker, and let the existing indexed, bounded hourly claim
   plus normal Temporal path own dispatch.
5. Risk: mixed Web/runner deployment wakes an older runner that still archives
   videos.
   Mitigation: deploy the snapshot-excluding Cloudflare runner fleet first,
   drain old containers, then deploy the Web migration; treat the new runner as
   the rollback floor until the re-armed cohort drains.

## Tasks

1. Add a narrow inbox-retention helper that lists normalized stored video paths
   from the canonical capture ledger and supports a hosted video-specific
   retention window.
2. Exclude those paths from every v2 hosted workspace archive plan and make
   hosted idle maintenance expire unprotected videos immediately while keeping
   unresolved accepted-input protection local to the warm container.
3. Add a one-time re-arm migration and update current owner/deploy docs.
4. Add focused inbox, assistant-runtime snapshot/maintenance/protection, and
   migration proof.
5. Run focused checks and typechecks, inspect privacy and deployment effects,
   then commit, open the PR, and complete CI plus ReviewGPT.

## Decisions

- Do not move video bytes to a second staging store or transient path family.
  That would add another persistence owner and complicate canonical capture
  repair. Keep the existing warm-workspace materialization and make durability
  exclude it.
- Do not make general retention failure block member replies or checkpointing.
  Snapshot exclusion supplies the independent privacy boundary; the existing
  retention transaction remains best-effort local cleanup with its retry wake.
- Preserve structural attachment metadata and parser derivatives after byte
  deletion so the conversation remains intelligible without retaining media.

## Verification

- Commands to run:
  - focused inbox media-retention tests;
  - focused assistant-runtime pending-input, idle-maintenance, snapshot-bridge,
    and hosted video-analysis regression tests;
  - focused Web migration test;
  - typechecks for inboxd, assistant-runtime, runtime-state, Cloudflare, and Web
    owners selected by the testing map;
  - privacy/path scans over the final diff;
  - preliminary `completion-specialists` and final ReviewGPT gates against the
    exact pushed candidate head, concurrently with required GitHub checks.
- Expected outcomes:
  - video bytes are absent from archive entries even while pending or when
    deletion fails;
  - unprotected video bytes are tombstoned and deleted on the next idle pass;
  - active protection never makes the video snapshot-durable;
  - images and audio retain the 14-day policy;
  - the re-arm migration is idempotent at the data-shape level and uses the
    existing due-work index/dispatcher;
  - all checks and review gates pass with no accepted unresolved findings.
