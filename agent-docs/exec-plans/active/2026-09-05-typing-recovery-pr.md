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

## Completion

- [x] Preserve five-minute cap in source, tests, contract, and public copy.
- [x] Review final source and timer/cooldown invariants; engine tests and runtime typechecks pass.
- [ ] Finish hosted and release-note proof plus web typecheck.
- [ ] Open draft PR, add its release-note reference, and prepare stable head.
- [ ] Complete ReviewGPT and required CI on the final head.
- [ ] Close the plan, verify mergeability, and report review results.

## Limits

Provider acceptance does not prove device rendering. Stop/start recovery may
briefly clear a visible indicator. One extra follow-up bounds normal delayed
progress recovery; longer delays converge at the regular 45-second refresh.
No merge or deployment is authorized by this PR request.
