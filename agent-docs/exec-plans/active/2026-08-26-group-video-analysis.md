# Enable group video analysis for any participant

Status: active
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Let any authenticated Linq or Telegram group participant explicitly request
  analysis of a video sent by any participant in the same accepted group turn.
- Keep the authority boundary at the active authenticated group and exact
  accepted video message without inventing requester/uploader identity rules.
- Ensure Murph never claims it inspected video frames unless the owned video
  analysis path actually ran.

## Product UX Feature

- Outcome: any participant can ask Murph a focused question about a group video
  and receive a truthful, bounded analysis in that group, regardless of who sent
  the video.
- Entry and promise: one authenticated participant sends a supported video and
  any authenticated participant explicitly asks Murph to inspect it in the same
  accepted group turn. Murph makes at most one bounded analysis call and replies
  in the group; ordinary video sharing triggers no analysis.
- Affected people: the participant who sent the video; the participant asking
  for analysis; other group participants who can see the answer; unverified
  external groups; and existing private-direct members.
- Authority: the selected video Message ref must belong to the current accepted
  turn and carry frozen attachment evidence under the active authenticated group
  route. The requester and uploader do not need to be the same person.
- Failure and recovery: unsupported, unavailable, changed, oversized, or
  provider-failed video receives a concise truthful limit or retry step. Murph
  must not imply that it extracted or reviewed frames through another path.
- Proof: deterministic planning, mailbox, attachment, cross-participant dispatch,
  and unverified-group denial tests; one focused real-Codex cross-participant
  journey with reviewed reply; and a production-shaped hosted-local round trip
  when the existing harness can represent the group authority.

## Scope

- In scope: authenticated Linq and Telegram group tool eligibility, exact
  accepted-video authority, attachment-evidence timing, assistant tool contract,
  direct and group regressions, real-Codex proof, durable owner docs, deployment
  guidance, and a public changelog item.
- Out of scope: unverified group email, automatic analysis, videos outside the
  current accepted group turn, a Gemini Files API lifecycle, durable analysis
  storage, queues, retries, model or FPS selection, and changes to ordinary
  private-direct video analysis.

## Constraints

- Preserve the existing frozen path, byte count, digest, MIME, signature,
  one-call, timeout, usage-recording, retention, and Worker credential owners.
- Reuse current group-route, accepted-input, and frozen attachment authority;
  add no requester identity input, sender comparison, database state, or second
  authorization owner.
- Keep provider-visible arguments bounded and avoid exposing sender identity to
  the model or Gemini.
- Preserve unrelated worktree state and use the task worktree and PR lane.

## Tasks

1. Reproduce and document the production failure from metadata-only evidence.
2. Extend group eligibility at the existing planning, attachment, and
   dynamic-tool boundaries without a requester/uploader identity gate.
3. Add deterministic same-message and cross-participant success,
   unverified-group denial, no-fabricated-analysis, and unchanged-direct
   regressions.
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

- Same-message request: the authenticated group turn receives
  `murph.analyze_video`, the model passes the exact video Message ref, and one
  successful bounded Gemini result can be reported to the group.
- Different participant: the model selects the exact accepted video Message ref
  from the same group turn and dispatch succeeds without a requester Message ref
  or sender comparison.
- Unverified external group: the planner omits the tool and mailbox import keeps
  the existing ineligible early-notify behavior.
- Private direct conversation: the existing video authority and one-call path
  remain unchanged.

## Local Evidence

- Production metadata-only correlation proved that the affected authenticated
  group turn received no video-analysis tool and made no video, shell, file,
  MCP, or provider-video action. The reply's frame-review claim therefore did
  not correspond to an executed capability.
- The first candidate's focused Assistant Engine and Runtime suites, package
  typechecks, docs checks, and exact-head CI passed, but that candidate encoded
  an unrequested same-uploader rule. The originating Codex plan had already
  labeled the existing group exclusion a privacy boundary and selected an
  uploader-authorized design before ReviewGPT ran; no product requirement or
  reproduced harm established that narrower boundary. Final ReviewGPT later
  found a spoofable model-controlled request ref inside the invented rule; the
  user then clarified that cross-participant analysis is intended, so the
  entire request-ref and sender comparison mechanism is being deleted rather
  than repaired.
- Corrected Assistant Engine proof passed 125 tests, including same-message and
  cross-participant group success, unverified-group denial, direct preservation,
  strict rejection of the removed request-ref field, and planning. Assistant
  Runtime video mailbox proof passed 6 tests with 64 unrelated cases skipped.
  Assistant Engine, Assistant Runtime, and Web typechecks passed.
- The focused real-Codex cross-participant journey uses production group
  instructions, the production prompt builder, the actual tool contract, a
  synthetic MP4, and a synthetic Gemini response. Its local subscription run is
  `Hold`: `ASSISTANT_CODEX_USAGE_LIMIT` occurred before any provider action, and
  no alternate local profile was explicitly authorized.
- Repeated normalized real App Server captures had zero volatile provider-input
  paths. Direct input changed from 25,670 to 25,706 tokens and 117,400 to
  117,603 UTF-8 bytes (+36, +0.1402%; +203 bytes). Group input changed from
  21,532 to 21,818 tokens and 98,683 to 100,079 bytes (+286, +1.3283%; +1,396
  bytes). The direct delta is the clarified tool description; the group delta
  is the newly available tool and schema. No requester-ref field remains.
- Corrected docs drift, docs gardening, changelog rendering, and diff hygiene
  checks passed. Exact-head review, CI, and merge/deploy proof remain pending.
- Final ReviewGPT round 2 found that the existing one-call counter was created
  inside each App Server provider request, so a held group draft followed by
  reconsideration could reset the ceiling within one assistant turn. The
  correction creates the same plain counter once beside the turn-owned frozen
  attachment authorities and passes that reference through both provider
  requests; it adds no persistence, registry, manager, or policy layer.
- Focused proof shows request 0 and request 1 share the exact counter reference,
  a completed request-0 call is visible to request 1, an unused request-0 state
  still permits request 1's first call, and the tool itself rejects a second
  provider call. Assistant Engine and Web typechecks, changelog generation and
  claim coverage, and doc gardening passed.
- The exact focused real-Codex journey remains `Hold`: the default local
  subscription reported a usage limit before any provider action, and the one
  repository-authorized alternate profile also failed before any provider
  action. No additional profile retry is permitted or needed for deterministic
  acceptance.
