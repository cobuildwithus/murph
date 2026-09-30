---
title: 'Scheduled image reminder gate expects retired image alt caption'
severity: 'minor'
issue: 'cobuildwithus/murph#3902'
---

## Expected Behavior

A scheduled generated-image reminder sends exactly the authored reminder text
with a separate media attachment. Distinct image alternative text remains an
input to image generation, not an appended Linq message caption.

## Current Behavior

The scheduled-reminder E2E still expects the reminder text, a blank line, and
the image alternative text. Linq delivery now sends the authored message text
without that suffix. The exact-text waiter therefore rejects the valid send
and times out despite successful attachment upload and message delivery.

## Minimal Reproducible Example

```ts
const reminderText = "Time to sleep.";
const imageAlt = "Synthetic sleep illustration";
const deliveredText = reminderText;
const retiredExpectation = `${reminderText}\n\n${imageAlt}`;

console.assert(deliveredText !== retiredExpectation);
console.assert(deliveredText === reminderText);
```

The existing exact-text waiter cannot match the delivered text against the
retired expectation. Set `scheduledReminderDeliveredText` to `reminderText`.
Keep the distinct image alt input and the separate media attachment assertions.

## Context

This stale test expectation blocks the protected scheduled-reminder gate.
Production delivery behavior must not change. Preserve the existing checkpoint
race, no-nudge delivery, due-time, completion, attachment-count, and usage-pricing
proof. The existing deterministic channel test and protected E2E own validation;
no additional harness or helper is needed.
