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

- Same-message uploader request: the authenticated group turn receives
  `murph.analyze_video`, the model passes the same exact Message ref as video
  and request authority, and one successful bounded Gemini result can be
  reported to the group.
- Current uploader follow-up: the tool accepts separate exact video and request
  refs only after both resolve through participant-effect authorization to the
  same provider source and normalized sender handle.
- Different participant: dispatch rejects the request before attachment
  materialization or provider egress, even when both people share a group or
  Family plan.
- Unverified external group: the planner omits the tool and mailbox import keeps
  the existing ineligible early-notify behavior.
- Private direct conversation: the existing video authority and one-call path
  remain unchanged; the optional request ref is omitted.

## Local Evidence

- Production metadata-only correlation proved that the affected authenticated
  group turn received no video-analysis tool and made no video, shell, file,
  MCP, or provider-video action. The reply's frame-review claim therefore did
  not correspond to an executed capability.
- Focused Assistant Engine proof passed 125 tests across video dispatch,
  planning, local-service behavior, and the focused real-journey definition.
  Focused Assistant Runtime video mailbox proof passed 6 tests with 64
  unrelated cases skipped. Both affected package typechecks passed.
- The focused real-Codex group-video journey uses the production base and group
  instructions, production auto-reply prompt builder, actual dynamic tool, a
  valid synthetic MP4 signature, and a synthetic Gemini response. Its live run
  failed closed before a provider action with `ASSISTANT_CODEX_USAGE_LIMIT`;
  no alternate subscription profile was authorized for retry.
- Repeated normalized captures through the pinned real Codex App Server and a
  local scripted Responses endpoint used identical synthetic direct/group video
  turns, `gpt-5.6-terra`, low reasoning, production code mode, and
  `gpt-tokenizer` 3.4.0 `o200k_harmony`. Direct input changes from 25,670 tokens
  / 117,400 UTF-8 bytes to 25,749 / 117,785 (+79, +0.3078%; +385 bytes). Group
  input changes from 21,532 / 98,683 to 21,861 / 100,261 (+329, +1.5280%;
  +1,578 bytes). Captures included `include`, `input`, `instructions`,
  `parallel_tool_calls`, `text`, `tool_choice`, and `tools`; normalized temporary
  paths and provider item ids; and excluded model selection, reasoning,
  storage/streaming, service tier, cache/client metadata, and transport headers
  identically. The direct delta is only the existing video-tool description and
  schema; the group delta is the newly present tool. Assembled instructions and
  all other provider-visible input are unchanged.
- Assistant Engine and Runtime typechecks, Web typecheck, docs drift, docs
  gardening, changelog registry tests, and `git diff --check` passed. The
  changelog registry now includes the member-visible capability and its
  privacy boundary.
