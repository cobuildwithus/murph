# Authorize group video analysis for the exact uploader

Status: active
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Let an authenticated Linq or Telegram group participant explicitly request
  analysis of a video they uploaded in the current accepted turn.
- Prevent another participant, group membership, or Family membership from
  authorizing cross-provider egress of that person's video.
- Ensure Murph never claims it inspected video frames unless the owned video
  analysis path actually ran.

## Product UX Feature

- Outcome: the uploader can ask Murph a focused question about their group
  video and receive a truthful, bounded analysis in that group.
- Entry and promise: an authenticated participant attaches a supported video
  and explicitly asks Murph to inspect it, either in the same accepted message
  or a current accepted follow-up. Murph makes at most one bounded analysis
  call and replies in the group; ordinary video sharing triggers no analysis.
- Affected people: the authenticated uploader making the request; other group
  participants who can see the answer; a different participant asking about
  someone else's video; and existing private-direct members.
- Authority: both the video Message ref and the explicit request Message ref
  must belong to the current accepted turn, resolve through the authenticated
  group route, and have the same provider-authenticated sender. Family or group
  membership alone grants nothing.
- Failure and recovery: unsupported, unavailable, changed, oversized, or
  provider-failed video receives a concise truthful limit or retry step. Murph
  must not imply that it extracted or reviewed frames through another path.
- Proof: deterministic planning, mailbox, attachment, dispatch, and negative
  cross-participant tests; one focused real-Codex journey with reviewed reply;
  and a production-shaped hosted-local round trip when the existing harness can
  represent the group authority.

## Scope

- In scope: authenticated Linq and Telegram group tool eligibility, exact
  requester/uploader authorization, attachment-evidence timing, assistant tool
  contract, direct and group regressions, real-Codex proof, durable owner docs,
  deployment guidance, and a public changelog item.
- Out of scope: unverified group email, automatic analysis, videos uploaded by
  another participant, Family-plan authorization, a Gemini Files API lifecycle,
  durable analysis storage, queues, retries, model or FPS selection, and changes
  to ordinary private-direct video analysis.

## Constraints

- Preserve the existing frozen path, byte count, digest, MIME, signature,
  one-call, timeout, usage-recording, retention, and Worker credential owners.
- Reuse accepted-message participant authorization; add no database state or
  second identity owner.
- Keep provider-visible arguments bounded and avoid exposing sender identity to
  the model or Gemini.
- Preserve unrelated worktree state and use the task worktree and PR lane.

## Tasks

1. Reproduce and document the production failure from metadata-only evidence.
2. Extend group eligibility and exact same-sender authorization at existing
   planning, attachment, and dynamic-tool boundaries.
3. Add deterministic positive, cross-participant denial, no-fabricated-analysis,
   and unchanged-direct regressions.
4. Add and run a focused real-Codex group-video journey and review Murph's
   actual synthetic reply.
5. Run focused owner checks, Product UX walkthrough, exact-head specialist and
   final ReviewGPT gates, CI, and merge preparation.

## Verification

- Focused Assistant Engine analyze-video, planning, local-service, and real-Codex
  journey tests.
- Focused Assistant Runtime mailbox conversation-import tests.
- Production-shaped hosted-local analyze-video round trip or a documented
  harness gap plus the strongest composed substitute.
- Package typechecks, provider-request guard when affected, `git diff --check`,
  privacy inspection, exact-head CI, preliminary Product UX/prompt/coverage
  ReviewGPT, and final sensitive ReviewGPT.

## Product UX Walkthrough

- Pending implementation.

## Local Evidence

- Pending implementation.
