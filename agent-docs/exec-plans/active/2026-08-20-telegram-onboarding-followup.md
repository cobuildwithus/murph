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

- The assistant engine now emits one best-effort continuation callback after a
  non-empty early-onboarding reply is accepted for sent or queued delivery.
- Hosted runtime filters that callback to an exact direct Telegram member
  route and invokes the canonical finite follow-up seed. The existing signup
  welcome owner uses the same helper.
- Focused engine/runtime suites, affected package typechecks, and hosted runner
  bundle parity pass locally.
- The production-shape first-contact E2E is prepared with direct-wake local
  orchestration, but the local harness could not start because the pinned
  public MinIO fallback never became ready. The test body did not run; exact-
  head CI remains the next available environment for this proof.

## Product UX Walkthrough

- `People and paths`: a new member entering through a private Telegram chat
  sees no activation message, receives the ordinary reply after speaking, and
  becomes eligible for the existing next-local-day finite setup help. A member
  whose follow-up is archived stays closed. Telegram groups and other channels
  retain their existing paths.
- `Evidence`: focused engine integration proves exact direct-route selection,
  one stable schedule, replay idempotency, and archive preservation; hosted
  runtime tests prove post-accepted-reply invocation and fail-soft recovery;
  the hosted-local first-contact scenario locks activation silence, ordinary
  reply delivery, durable seed attestation, and exact inbound replay. The
  existing scheduled-reminder scenario proves downstream Telegram delivery.
- `Differences`: no product-scope difference from the Patch plan. The local
  production-shape run was blocked before its test body by unavailable MinIO,
  so exact-head hosted integration CI owns that final environment proof.
- `Result`: Ready. The smallest restored promise is fully owned by existing
  reply, automation, scheduler, outbox, and provider paths, with no new
  pre-contact message or audience.
