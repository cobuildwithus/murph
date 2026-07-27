---
name: phone-calls
description: Use when Murph may place an outbound health-related phone call to a clinic, dentist, pharmacy, lab, insurer, provider office, or similar destination. Covers call choice, explicit consent, appointment readiness, minimal disclosure, transfer policy, and truthful interpretation of call lifecycle results.
---

# Phone Calls

Use `murph.create_phone_call` for one authorized outbound call on the user's
behalf when a human call is genuinely faster or the only workable path. Prefer
a structured integration or browser action when either can complete the
operation without a call.

Never call emergency services. For urgent or emergency symptoms, follow Murph's
health-safety guidance and direct the user to the appropriate immediate help.

## Establish authority and the call goal

Place a call only when the user asked for it or clearly approved this specific
call. Offering to call is not approval. Resolve the official destination,
purpose, success criteria, timezone, concrete dates/times, and disclosure bounds
from the current request and trusted context.

Before placing the call, tell the user in one short line what Murph will ask and
what it will share so they can correct it. Do not imply the call started until
the tool result says so.

For appointment booking, rescheduling, cancellation, or waitlist action, also
read `$MURPH_ASSISTANT_SKILLS_ROOT/appointment-scheduling/SKILL.md` and satisfy
its ready-to-act gate. Check context, canonical memory, and the official site;
identity alone is incomplete. Information-only and connectivity-test calls must
remain non-mutating, separate, and never count as appointment readiness.

## Build a minimized call brief

- Set `to` to the verified official destination.
- Resolve relative dates and times to concrete dates and pass the user's
  timezone.
- Set `callerName` to the user-approved first name or other name Murph may use
  to identify who it is calling for. Omit it when no name is approved or it
  does not make sense for the call.
- Put only user-approved, call-relevant, disclosable facts in `shareableFacts`.
  Include what the callee will legitimately need and nothing more.
- Never include unrelated health details, identifiers, payment information,
  credentials, or the user's transfer phone number. Murph resolves a verified
  transfer number server-side.
- Facts outside `shareableFacts` require consultation with Murph during the
  call; do not use that as a way to hide or broaden disclosure.

Set `allowTransferToUser: true` when live identity verification, personal
consent, or in-the-moment judgment is likely unless the user says not to
transfer. Set it to `false` for information-only calls, simple status checks,
group calls, or any call where a transfer would surprise the user.

For a group-chat call, pass the exact opaque `message_ref` printed beside the
accepted message whose sender requested or approved the call. Do not infer one
requester from every message in the turn, reuse another participant's ref, or
supply a canonical member id. The host reloads that exact accepted input and
Web revalidates the provider sender's current room membership and Murph
activation. If exact participant authority is unavailable, do not place the
call; the normal conversational reply may still continue.

## Interpret results truthfully

`murph.create_phone_call` returns a start status and call id, not the
conversation or outcome:

- `starting`: dispatch is unconfirmed; do not say the call was placed.
- `calling`: the provider accepted or placed the attempt. It may already have
  ended; do not say it is still calling.
- `failed`: the attempt was unsuccessful. This does not prove that no provider
  attempt occurred.

Await the later call result before claiming connection, an answer, a booking,
an agreement, or any other outcome. Report only result-backed facts and keep a
failed or ambiguous attempt separate from completion.
