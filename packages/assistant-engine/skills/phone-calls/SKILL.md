---
name: phone-calls
description: Use when Murph may place one authorized outbound call for a health task, or when hosted group Murph may call a public venue or service business for an ordinary shared-life logistics task. Covers call choice, consent, health appointment handoff, reservation bounds, minimal disclosure, group requester attribution, transfer policy, and truthful interpretation of call lifecycle results.
---

# Phone Calls

Use `murph.create_phone_call` for one authorized outbound call on the user's
behalf for an in-scope health task, or on the current room's behalf for an
in-scope shared-life logistics task, when a human call is genuinely faster or
the only workable path. Prefer a structured integration or browser action when
either can complete the operation without a call.

Never call emergency services. For urgent or emergency symptoms, follow Murph's
health-safety guidance and direct the user to the appropriate immediate help.

## Establish authority and the call goal

Private and hosted-group calls use the same consent and readiness flow. Follow
the current request and the applicable skill's explicit-consent or ready-to-act
gate. Use a short natural-language preview and confirmation only when the
requester still needs to inspect material terms. Never emit a special structured
preview, or require a second turn, merely because the request came from a group.

In a hosted group, the current bounded request may authorize the call in the
same provider turn. Set `message_ref` to that request's visible `ain_...`
reference. It must still be the newest accepted request when the call starts.
The host reloads that exact message and revalidates the provider sender's current
room membership and Murph activation. Do not infer one requester from every
message in the turn, reuse another participant's ref, or supply a canonical
member id.

The current requester must explicitly supply or approve any requester name or
contact fact used in the call. One participant's request never authorizes a
different participant's identity, account, contact details, health facts, or
other private facts. If the task, material terms, or required disclosure are
unclear, ask one narrow question before calling. Do not imply the call started
until the tool result says so.

For a hosted-group reservation, availability check, or service call, do not load
`appointment-scheduling` unless health care is involved. Resolve the official
destination, concrete date/time bounds, party size or resource count, duration,
acceptable price or fees, cancellation terms, and whether the destination
requires a requester name or contact fact. Ask before calling when a missing
term or requester fact could create a charge, commitment, materially different
booking, or failed reservation. An information-only call must stay non-mutating.
Do not make a purchase, payment, reservation, or other commitment unless the
requester explicitly asked for it and supplied adequate bounds.

Do not place prank, harassment, impersonation, unsolicited sales, recruiting, or
bulk-outreach calls. This skill never expands the conversation's scope boundary
or authorizes code production or work, school, or professional operations.

For health care appointment booking, rescheduling, cancellation, or waitlist
action, also read `$MURPH_ASSISTANT_SKILLS_ROOT/appointment-scheduling/SKILL.md`
and satisfy its ready-to-act gate. Check context, canonical memory, and the
official site; identity alone is incomplete. Information-only and
connectivity-test calls must remain non-mutating, separate, and never count as
appointment readiness.

## Build a minimized call brief

- Set `to` to the verified official destination.
- Resolve relative dates and times to concrete dates and pass the user's
  timezone.
- Set `callerName` to the user-approved first name or other name Murph may use
  to identify who it is calling for. In a group, use only a name the current
  requester explicitly authorized for this call; omit it when no one may be
  represented.
- Put only call-relevant, disclosable facts approved by the requester in
  `shareableFacts`. In a group, room-visible logistical facts may be used. A
  requester name or contact fact may be disclosed only when the destination
  requires it and the current request explicitly supplies or approves it;
  never infer or disclose another participant's private identity, account,
  contact, or health facts.
- Never include unrelated health details, identifiers, payment information,
  credentials, or a participant's transfer phone number. Murph resolves an
  eligible verified transfer number server-side for private calls; group calls
  never transfer.
- Facts outside `shareableFacts` require consultation with Murph during the
  call; do not use that as a way to hide or broaden disclosure.

Set `allowTransferToUser: true` when live identity verification, personal
consent, or in-the-moment judgment is likely unless the user says not to
transfer. Set it to `false` for information-only calls, simple status checks,
group calls, or any call where a transfer would surprise the user.

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
