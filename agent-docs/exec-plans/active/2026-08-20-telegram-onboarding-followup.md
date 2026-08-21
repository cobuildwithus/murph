# Telegram Onboarding Follow-up

Status: active
Created: 2026-08-20
Updated: 2026-08-20

## Goal

Preserve Telegram's member-initiated first-contact boundary while ensuring that
the first accepted private conversation seeds the existing finite unfinished-
onboarding follow-up. Prove the hosted transition locally: no signup welcome
before contact, an ordinary reply after contact, one durable follow-up seed,
and no duplicate reply or seed when the inbound wake replays. Retain the
existing hosted-local scheduled-reminder E2E as the downstream Telegram
delivery proof.

## Root Cause Evidence

- Hosted activation intentionally suppresses Telegram signup welcomes before
  both provider delivery and unfinished-onboarding follow-up creation.
- The follow-up seed is currently coupled to successful or superseded signup-
  welcome delivery, so a correctly suppressed Telegram welcome also suppresses
  the continuation.
- Managed automation maintenance reconciles an existing follow-up but does not
  create a missing signup-scoped record. A Telegram member therefore cannot
  recover that continuation through ordinary maintenance alone.

## Product UX Patch

- `Outcome`: a new Telegram member who starts the conversation can receive the
  existing bounded help to finish onboarding if it is still incomplete.
- `Reaches`: first private Telegram inbound, its ordinary reply, and the next
  eligible local-day follow-up; activation before that inbound stays silent.
- `Proof`: the production-shape first-contact E2E proves no pre-contact
  outbound or seed, one reply, one durable finite seed, and no duplicate reply
  or seed on replay. The existing hosted-local Telegram scheduled-reminder E2E
  proves the same scheduler/outbox/provider path used by the finite follow-up.

## Constraints

- Do not send a Telegram signup welcome or any other proactive message before
  the member starts the bot conversation.
- Reuse the existing canonical onboarding state, automation definition,
  scheduler, outbox, route authority, and provider delivery owners.
- Do not create a second retry loop, scheduler, queue, or persisted lifecycle.
- Keep the foreground reply path free of unrelated maintenance and avoid
  delaying the member's current reply.
- Make replay idempotent and do not reactivate an archived or completed
  follow-up.
- Keep fixtures and review artifacts synthetic and free of private evidence.

## Planned Changes

1. Trace the accepted private Telegram input boundary and write a failing
   hosted-local scenario for the missing continuation.
2. Reuse the existing follow-up seed at the smallest member-initiated Telegram
   boundary that already owns durable accepted-reply evidence.
3. Add focused unit/integration proof for idempotency, completed onboarding,
   activation silence, replay safety, and the hosted-local delivery path.
4. Update the owning runtime/reliability docs and public changelog only where
   the shipped behavior changes.

## Verification

- Focused assistant-runtime tests for Telegram activation and first-contact
  seed ordering.
- Production-shape hosted-local Telegram E2E through the ordinary provider
  callback boundary.
- Affected package typechecks and lint/static checks.
- Exact-head GitHub Actions, preliminary Product UX and coverage ReviewGPT
  lenses, and the sensitive final ReviewGPT gate.

## Progress

- Accepted early-onboarding delivery now commits only the existing durable
  first-contact marker plus an immutable pointer to the exact accepted turn.
  Post-checkpoint managed-automation maintenance resolves that turn's completed
  receipt and exact sent outbox intent, then invokes the canonical finite seed
  only while onboarding remains open and the original window is still live.
- The existing managed-setup retry ladder owns transient seed-write recovery,
  so the member's reply does not wait on automation maintenance and recovery
  does not require another member message or replay the accepted input.
- ReviewGPT identified the original foreground best-effort callback as an
  unrecoverable write gap; the callback plumbing was removed in favor of this
  durable owner and a production-shaped failure-then-retry test.
- ReviewGPT round 2 then identified retry-time and ambient-route reconstruction
  inside the replacement owner. The recorded retrospective chose a bounded
  redesign: historical markers are ineligible, later replies cannot replace the
  first turn, route comes from its exact sent intent, and the cutoff comes from
  its completed receipt. No new queue, scheduler, or lifecycle owner was added.
- The accepted-turn anchor uses the existing per-vault runtime write owner and
  atomic no-clobber state-file adoption. A concurrent first-contact test caught
  and prevented a transient hard-link race, proving that racing accepted turns
  still leave exactly one immutable pointer.
- Focused engine/runtime suites, all three affected package typechecks, agent
  docs drift, public changelog tests, and hosted runner bundle parity pass
  locally. The six focused suites pass all 672 assertions, the changelog suites
  pass all 49 assertions, and the runner bundle is 11,105,923 bytes of its
  11,393,617-byte budget.
- The production-shape first-contact E2E is prepared with direct-wake local
  orchestration, but the local harness exhausted its five-minute setup hook
  while the pinned MinIO mirror fell back to the public image. The four
  application assertions were skipped; exact-head CI remains the next
  available environment for this proof.

## Product UX Walkthrough

- `People and paths`: a new member entering through a private Telegram chat
  sees no activation message, receives the ordinary reply after speaking, and
  becomes eligible for the existing next-local-day finite setup help. A member
  whose follow-up is archived stays closed. Telegram groups and other channels
  retain their existing paths.
- `Evidence`: focused engine integration proves exact direct-route selection,
  immutable first-turn gating, divergent ambient-route rejection, an original
  cutoff preserved through delayed recovery, historical-marker and expired-
  window exclusion, replay idempotency, completed-state closure, and archive
  preservation; hosted runtime tests prove post-checkpoint invocation and a
  transient canonical-write failure recovering on the next managed wake
  without new member input;
  the hosted-local first-contact scenario locks activation silence, ordinary
  reply delivery, durable seed attestation, and exact inbound replay. The
  existing scheduled-reminder scenario proves downstream Telegram delivery.
- `Differences`: no product-scope difference from the Patch plan. The local
  production-shape run was blocked before its test body by unavailable MinIO,
  so exact-head hosted integration CI owns that final environment proof.
- `Result`: Ready. The smallest restored promise is fully owned by existing
  reply, automation, scheduler, outbox, and provider paths, with no new
  pre-contact message or audience.
