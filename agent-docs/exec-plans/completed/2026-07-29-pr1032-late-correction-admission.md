# PR 1032 late-correction admission

## Problem

The direct/group compound-turn selector now applies the ordinary native-reply
anchor boundary before the existing trusted Linq correction exception. A
correction whose exact `editedSourceInputId` is already accepted by the active
turn is therefore filtered out as `no-new-input` because its provider
`replyToMessageId` differs from the original message.

## Outcome

Preserve direct-turn single-anchor semantics for ordinary native replies while
allowing only a structurally valid Linq correction targeting an exact input
already owned by the active turn to reach the existing correction admission
checks.

## Invariants

- Ordinary direct native replies still start a fresh turn.
- Corrections to older or otherwise unaccepted inputs remain pending for the
  next ordinary scan.
- Malformed partial correction metadata does not bypass the boundary.
- Authenticated group-room batching and participant authority remain unchanged.
- Add no state owner, queue, retry, cache, or compatibility mechanism.

## Verification

- Reproduce the two CI failures in
  `assistant-automation-reply-event-path.test.ts`.
- Cover accepted-initial, accepted-live, older-input, ordinary native-reply,
  and malformed-correction boundaries.
- Run the focused Assistant Engine suite, typecheck, canonical diff, final
  ReviewGPT correction round, and exact-head CI.

## Result

- Root cause was the shared adjacency selector applying the direct native-reply
  anchor boundary before the existing trusted-correction exception.
- The selector now receives only the live context's accepted input IDs and
  bypasses that anchor comparison only for a structurally complete Linq edit
  targeting one exact accepted input. The existing admission gate revalidates
  the same link.
- Ordinary native replies, malformed edit metadata, older-message corrections,
  authenticated group batching, and participant authority are unchanged.
- Assistant Engine typecheck passed. Local Vitest execution was blocked after
  suite load by shared-host contention, but the exact previously failing
  `Release package coverage (assistant)` CI shard passed on the pushed
  implementation head.
- Final ReviewGPT packaging and PR-body publication remain blocked by the local
  GitHub CLI credential returning HTTP 401; SSH push access remains available.
Status: completed
Updated: 2026-07-29
Completed: 2026-07-29
