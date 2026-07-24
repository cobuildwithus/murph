# Shorten the group contact-card re-share throttle window

## Problem

PR #912 fixed group contact-card re-share but left the per-chat share throttle
at 10 minutes. That window is far longer than anything it needs to guard and
still reproduces a slice of the original friction: a genuine "resend, he didn't
get it" request inside 10 minutes silently returns `already_shared` and posts no
new card.

## Why the throttle exists (verified, not removed)

The `share_contact_card` side effect runs live inside the model turn and is not
journaled. The hosted turn retries up to 6 times
(`hosted-user-runtime.ts`, `maximumAttempts: 6`), and the provider idempotency
key is derived from the reservation instant, so it differs on every firing.
The durable `hostedLinqContactCardShare` reservation row is therefore the only
thing that collapses a duplicate `share_contact_card` firing across a
retried/replayed turn or a coalesced wake burst. Removing it would post
duplicate vCards on the retry path — a line-health risk for a group of mostly
non-users. The group tool is the reservation seam's only caller.

## Fix

`apps/web/src/lib/hosted-onboarding/linq-contact-card-share.ts`:
`HOSTED_LINQ_CONTACT_CARD_SHARE_THROTTLE_MS` drops from `10 * 60 * 1000` to
`90 * 1000`. 90s covers the retry-backoff / burst horizon while being
imperceptible to a genuine human re-request (which arrives minutes later, after
the card is already visible in the chat). Docstring and the two window-dependent
test cases in `hosted-onboarding-linq-contact-card-share.test.ts` updated.

## Invariants

- The reservation remains the durable retry/burst dedup guard; only its window
  shrinks.
- Authority, eligibility, roster, and failed-send release paths are unchanged.
- No new persisted state.
Status: completed
Updated: 2026-07-24
Completed: 2026-07-24
