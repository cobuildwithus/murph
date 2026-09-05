# Typing recovery PR

## Final outcome and owners

Keep the existing five-minute iMessage typing cap and ten-minute restart
cooldown. Ship recovery for transient refresh errors, delayed progress sends,
client-cleared indicators, and stale cleanup through the existing engine timer
and hosted target-claim owners. No durable or wire state changes.

Linq documents 85–90 seconds per typing start and recommends a 60-second
refresh. Its roughly five-minute note concerns recent outbound message
activity; it does not publish a maximum session length. Use the existing
conservative cap while retaining the recovery fixes.
Source: https://docs.linqapp.com/channel/imessage/guides/chats/typing-indicators/

## Product UX (Patch)

- Outcome: recoverable typing during active replies with the existing cap.
- Reaches: direct and group iMessage; unchanged other channels and final replies.
- Proof: engine/runtime fake-clock and provider-shaped recovery/cap tests,
  unchanged delivery-service proof, and release-note archive rendering.

## Implementation and PR preparation

- [x] Preserve five-minute cap in source, tests, contract, and public copy.
- [x] Engine runtime/delivery tests (114), hosted typing tests (22), and archive
  rendering tests (9) passed with the final five-minute cap.
- [x] Engine, assistant-runtime, and web typechecks passed.
- [x] Parent review and complexity guard passed; unrelated send-function debt
  is unchanged and no typing function exceeds the threshold.
- [x] Open draft PR https://github.com/cobuildwithus/murph/pull/2895 and add its
  actual release-note reference.
- [x] Archive implementation evidence before freezing the review candidate.

## External completion ownership

ReviewGPT and required CI are pending when this implementation plan is archived.
Their exact-head results, findings, dispositions, and mergeability evidence will
be recorded in PR #2895 by the same completion owner. Archiving this local
implementation evidence does not declare the PR green or authorize a merge.

## Limits

Provider acceptance does not prove device rendering. Stop/start recovery may
briefly clear a visible indicator. One extra follow-up bounds normal delayed
progress recovery; longer delays converge at the regular 45-second refresh.
No merge or deployment is authorized by this PR request.
Status: completed
Updated: 2026-09-05
Completed: 2026-09-05
