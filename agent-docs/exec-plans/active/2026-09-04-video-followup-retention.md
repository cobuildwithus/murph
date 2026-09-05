# Video follow-up retention

## Outcome and scope

Retain ordinary incoming videos in the existing encrypted workspace for the
standard 14-day media window so a later question can use the same clip.
This is a Product change to the existing video-analysis journey.

## Evidence and architecture

Hosted idle maintenance currently overrides video retention to zero, snapshot
construction excludes ordinary videos, and analysis filters frozen attachment
authority to the current accepted input. All three prevent follow-up analysis.
Reuse canonical inbox media storage, atomic retention, and the existing
conversation-scoped input history; introduce no storage service or result cache.
Freeze eligible historical attachment metadata before provider execution and
keep current route scope, byte verification, and one provider call per turn.

## Product UX plan

- Entry and promise: send a video, receive a reply, then ask another question
  about that video in the same conversation without resending it.
- Private conversation: follow-up references resolve only within that direct
  conversation. Existing prior analysis remains useful conversational evidence.
- Authenticated group: another participant can ask about the earlier group
  clip; private or other-group clips remain outside that conversation.
- Restart and expiry: retained bytes survive checkpoint/restore; unavailable or
  expired clips produce truthful recovery rather than invented observations.
- No new background sends, audience, provider, or usage policy.

## Implementation and proof

- [x] Remove hosted-only immediate expiration and snapshot exclusion.
- [x] Resolve earlier same-conversation video authority before provider execution.
- [x] Prove follow-up, cross-conversation denial, expiry, and checkpoint inclusion.
- [x] Run focused tests and affected typechecks, then one real-Codex journey.
- [x] Update owner docs and changelog; review scope and complexity.
- [ ] Scoped commit, draft PR, exact-head CI and routed ReviewGPT gate.

## Status

Implementation and local verification complete; PR gates remain. The optional retention
preference question uses the existing 14-day media policy as its default.
The supplied graph workflow is unavailable: neither the graft command nor a
graft index exists in this checkout. Direct scoped source inspection was used.

## Local evidence

- Inbox/media and video-authority suites: 68 tests passed; the final video-tool
  rerun passed 39 tests. Existing live-input video reconsideration: 2 passed.
- Runtime idle maintenance passed in the combined run. Snapshot inclusion and
  nonblocking log-drain proof passed in isolation after earlier local load
  exposed the existing 250 ms test deadline; no timing assertion was changed.
- All three affected package typechecks passed; inboxd and assistant-runtime
  package builds passed. Changelog rendering: 9 tests passed.
- Native scripted Responses capture, identical direct/group fixtures, normalized
  temporary paths and opaque native identifiers, GPT-5 Codex o200k_base encoding:
  direct 25,988 -> 26,021 tokens (+33; +0.127%), 120,109 -> 120,305 UTF-8 bytes;
  group 21,767 -> 21,800 tokens (+33; +0.152%), 100,804 -> 101,000 bytes.
  Capture includes the complete provider-visible input after native tool
  assembly; request transport/cache/client metadata is excluded. Comparison
  proved only the video tool description and message-ref guidance differ.
  The probe used the existing scripted runtime harness with a loopback provider;
  it made no external provider call and its temporary instrumentation was removed.
- The first real-Codex follow-up reached analysis successfully, then the model
  dereferenced a nonexistent result field in code mode and lost the answer.
  One tool instruction now directs it to print the complete return value.
  The same focused journey passed: first-turn acknowledgement, one later video
  call, and a correct concise answer. Product UX verdict: Ready. No assertion
  was weakened. The focused command is `pnpm test:assistant:live -- --test
  "analyzes a retained video"`, model `gpt-5.6-terra`, local subscription auth.
