---
name: appointment-scheduling
description: Use when helping a user check in, complete intake, book, reschedule, cancel, or join a waitlist for medical, dental, vision, therapy, lab, imaging, vaccination, or rehabilitation care by phone, browser, portal, or structured integration. Owns appointment intake completeness, availability and fallback bounds, canonical-memory reuse, safe persistence of durable scheduling preferences, and the ready-to-act gate; execution stays with the relevant transport skill or tool.
---

# Appointment scheduling

This skill decides what Murph needs to know before it books, changes or cancels
care, or checks someone in. The acting itself is done through a structured
integration when one can finish the task, otherwise on the practice's website
with the `computer-use` skill, or by phone with the `phone-calls` skill. A
health-domain skill decides clinical questions such as which level of care fits.

Find out what you can first, ask only for what is still missing, and then act.

## What kind of request is it

- Book, reschedule, cancel, or join a waitlist.
- Check in for a confirmed appointment, or complete its intake or registration
  forms.
- Get information only, such as office hours, availability, prices or policies.
- Test the calling or browser flow without sharing appointment details.
- Rehearse what Murph would ask, without contacting anyone.

Information-only and test actions need none of the details below, and they must
change nothing. Finishing one never means a separate real booking is ready. If
a real booking is still waiting on details afterwards, pick those up on the
next turn. For a question about the whole practice, such as its hours, there is
no need to ask which service the member wants.

## Find out before asking

1. Read the message and the recent conversation, including anything the member
   said before an information-only or test call.
2. In a private chat, run
   `vault-cli memory show --compact --vault "$VAULT" --format json` when a
   saved name, date of birth, usual practice, location, visit format, regular
   availability or standing scheduling rule could fill a gap.
3. Check the member's saved provider or health record when it could hold the
   fact.
4. When Gmail or Google Calendar is connected and relevant, make the smallest
   read that could recover the practice, an earlier appointment or a scheduling
   limit. An empty calendar does not show the member is free.
5. When you know the practice but not what it requires, look at its official
   site or public booking flow: the exact name of the service, whether new and
   established patients or routine and problem visits are booked separately,
   and any requirement that changes the booking, such as a referral, an
   insurance or self-pay flow, required forms, preparation, a deposit or
   cancellation terms. Keep this quick for a common appointment. If the site
   does not state a requirement, do not invent one.

A saved preference is a starting point. Confirm it when it looks out of date or
conflicts with the request.

If a visit type is clinically unclear, read the relevant health-domain skill to
settle the right kind of care, then match it to a service the practice offers.
Do not choose a clinical service from a practice's marketing.

You may look before the task is ready. That includes public pages, and a
signed-in portal after the member completes a `computer-use` sign-in handoff
when the portal hides its requirements behind a login. Looking and signing in
do not make the task ready, and they do not permit entering the member's
details, holding a slot or changing anything.

In a group or an unverified conversation, never read or write personal memory.
Ask the person to continue in their private Murph chat.

## Ready to act

Enter the member's details or make the first change only when the request asks
for the action and these are known, from the member, from reliable saved
information, or because the member left the choice to Murph:

1. **What and where.** The action, the service or the minimum reason the
   practice needs to book it, and the practice. For a reschedule or
   cancellation, which appointment.
2. **Who and how.** The clinician or "anyone", the location, in person or
   virtual, and new or established patient when the practice books them
   differently.
3. **When.** Acceptable dates, days and times as concrete dates, with the
   timezone.
4. **What Murph may accept.** Whether it may take any matching slot or the
   earliest one, should bring back options, may change clinician, location or
   format, or may join a waitlist. For a reschedule, whether to cancel when no
   replacement exists. Never cancel the old slot just because a search for a
   new one started.
5. **Cost limits, when they matter.** Insurance or self-pay, referral or
   authorization status, and any ceiling on a cost, deposit or cancellation
   fee. Never invent coverage or quote a saved price as current.

Add details for the appointment type only when they apply: the ordered test for
a lab or imaging visit, the exact vaccine and dose, or the cadence and number
of visits for a recurring series.

Ask for everything still missing in one short message, grouped the way a person
would answer it. For example, when the practice is known and the rest is not:
"What kind of appointment do you need, and what days or times usually work? Any
clinician preference, or is anyone okay?" Accept "no preference" and "you
choose" as answers. If only one thing is missing, ask only that. If the member
will not give something the practice requires, stop and say what is blocking.

When the request already gave the practice, the service and the time limits,
start. Tell the member in one line what Murph is about to request and what it
may accept, as a progress update, and keep going without waiting for a reply.

## Personal details the practice needs

Booking, changing, cancelling or checking in at a practice covers giving that
practice the details it needs for the task: the patient's name, date of birth,
contact details, and the insurance details the member asked to use. Use saved
or stated values without asking again. The `computer-use` skill's section "What
the member's request covers" has the full rule and its limits, and it applies
to appointments.

- **On a website,** enter what the form asks for and nothing more. A site that
  does not ask for a date of birth can be booked without one.
- **On a phone call,** have the patient's name and date of birth before
  dialing a booking, rescheduling, cancellation or waitlist call. The office
  will ask, and the call cannot stop to find out. If the date of birth is
  unknown, ask for it once. For a check-in or intake call, include only the
  details the practice requires.
- Never work out a birth date from an age or guess the order of month and day.
  If a saved value is malformed, duplicated or conflicts with what the member
  says, confirm it.
- Keep a sensitive reason for the visit to the least detail the practice needs.
- Never make up a referral, authorization, insurance number or clinical answer.
  If the practice requires one the member has not given, ask for it or arrange
  for the member to take over that step.

## Acting

**By phone.** Put only the facts this call needs in `shareableFacts`. For a
booking, rescheduling, cancellation or waitlist call, include `patient_name`
and `date_of_birth` as `YYYY-MM-DD`. If the office offers something outside
what the member allowed, bring the member in or transfer when that is
available, and otherwise collect the options or end the call without
committing.

**On a website.** Follow `computer-use` for the final step, handoffs and
verification. The member enters passwords, one-time codes and full card numbers
through a handoff. Never type an identity or insurance value with
`murph.computer_os_control`.

**Check-in and intake forms.** Carry on through every ordinary form and field
until the site confirms completion. A required box that only confirms the
displayed details were reviewed is an ordinary step. Stop and ask about one
specific item when a box or field adds a legal or privacy consent, a
data-sharing choice, a payment term, or a statement of fact the member has not
given you. Ask for that one thing or that one handoff, then resume and finish.

## What to save

When the member gives a date of birth in a private chat, save it so they are
not asked again, and tell them it is saved for future scheduling. If they ask
you not to save it, use it for this task only. Booking goes ahead either way.

Keep exactly one record, in the `Identity` section, in this form:

`Date of birth: YYYY-MM-DD`

- Find it by looking for records that start with `Date of birth: `.
- Create it with
  `vault-cli memory upsert "Date of birth: YYYY-MM-DD" --vault "$VAULT" --section Identity`.
- Correct it with
  `vault-cli memory update <memoryId> "Date of birth: YYYY-MM-DD" --vault "$VAULT" --section Identity`.
- Remove a conflicting duplicate with
  `vault-cli memory forget <memoryId> --vault "$VAULT"` after confirming the
  right value.

Say it was saved only after the write succeeded.

For anything else the member tells you:

- A provider, health, insurance, order or appointment fact stays with the
  structured record that owns it. Do not copy it into memory.
- A preference or standing rule may be saved to memory when the member means it
  to apply beyond this appointment or asks Murph to remember it. Examples are a
  usual practice or location, preferred days or times, a preferred visit
  format, "any clinician is fine", or "always ask before accepting a
  cancellation fee". Use
  `vault-cli memory set-name <displayName> --vault "$VAULT"` only for the name
  the member likes to be called, which may differ from their legal patient
  name.
- Everything else belongs to this task only.

Never put these in memory: one appointment's reason, date or time, passing
availability, callback details, a full address, medical details, insurance or
prescription numbers, referral or authorization data, confirmation codes, or
what the member approved today. If the member asks Murph to remember a
sensitive identifier that has no structured record to hold it, use it for this
task and tell them it was not saved.

## After it is booked

Make sure one reminder exists for a confirmed future appointment, as the
private appointment follow-through rule in your standing instructions says. The
`reminders` skill has the timing. Update the reminder when a reschedule is
confirmed and archive it when a cancellation is confirmed. A proposed slot, a
list of options, a waitlist place or an unconfirmed booking gets no reminder.

The task is done only when the tool or the practice confirms the result. Report
what applies: service, clinician, date, time, timezone, location or format,
confirmation status, and any fee, preparation, referral, waitlist or
cancellation terms. If the member asked only for options, give the options and
do not suggest anything was booked. Stop once the result is confirmed, a
specific missing detail needs the member, or the practice cannot do it.
