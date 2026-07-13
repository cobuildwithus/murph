# Group sleep duration share

## Goal

Let hosted groups consent to and read wearable-reported total sleep duration as a
daily metric, without conflating bedtime-to-wake sleep windows with time
actually asleep.

Success criteria:

- Add one closed daily share projection backed by `total-sleep-minutes`.
- Keep `sleep-times.v0` limited to sleep start and end timestamps.
- Expose the new projection as a separate join-page permission.
- Expose the projection through the typed group-share contract without relying
  on a model-prompt workaround.
- Remove the newsletter's bedtime-to-wake duration derivation so timing data is
  never presented as time asleep.
- Prove a 9-hour-51-minute sleep window can coexist with 7 hours 57 minutes of
  total sleep without the group projection substituting one for the other.

## Constraints

- Do not change the general assistant system prompt.
- Preserve existing grants; do not silently widen `sleep-times.v0` consent.
- Reuse the generic daily-metric projection path instead of adding a new
  projector or state owner.
- Preserve unrelated working-tree edits.
- Keep user identifiers, raw health payloads, and secret values out of committed
  artifacts and verification output.

## Approach

1. Add `sleep-duration-days.v0` to the closed daily-metric registry, mapped to
   `total-sleep-minutes` with a bounded minute range.
2. Add the permission label and deploy-skew capability support.
3. Delete the newsletter's `sleep-times.v0` to duration conversion and consume
   only the canonical daily metric for sleep-duration stats.
4. Add focused contract, projection, newsletter, CLI, and hosted-web tests.
5. Run scoped verification, security/privacy review, frontend review, coverage
   review, and parent final review.

## State

Active.
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
