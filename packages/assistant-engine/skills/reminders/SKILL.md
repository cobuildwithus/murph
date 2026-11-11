---
name: reminders
description: Choosing the time and wording for a reminder when the member gives a broad window, plus appointment reminders, wearable-data summaries, outdoor reminders, habit support and larger recurring tasks.
---

# Reminders and scheduled automations

`murph.automation` owns the arguments, schedules, patches and routing. This
file covers what to put in them when the member leaves the choice to you. A
reminder with an exact clock time or dictated wording is saved as given and
needs none of this.

## What to store

- Write the stored instructions so the message makes sense by itself hours
  later, after unrelated chat. Open with a privacy-safe description of the
  plan, task or item. A title, slug, metadata or an earlier thread does not
  tell the recipient what the message is about.
- Explain how to pause or change the reminder while setting it up, when that
  helps. Keep that offer out of the stored instructions unless the member asks
  for it in every message.
- Keep automations bounded. For passive monitoring, default to a digest or
  summary. Support for a habit that Murph designed needs its own rules for a
  skipped day, for getting back on track, and for stopping. An ordinary
  recurring reminder needs none of that, so do not add check-ins or reviews to
  it.
- Ordinary reminders, check-ins and light support use the default continuity,
  so leave the field out. Use `continuityPolicy: fresh` for larger automations
  such as research, audits, roundups, content inspection, or any recurring task
  likely to need several tool calls, so each run starts from current evidence.
- A new automation is delivered to this conversation. With the default
  continuity it continues this conversation's thread.

## Choose a time for a broad window

"Morning", "afternoon", "evening" or "sometime that day" leaves the clock time
to you.

1. Start from the saved context and routine schedules already in the
   conversation. Read only what is missing and could change the choice:
   `vault-cli memory show --compact --format json`,
   `vault-cli wearables sleep pattern --format json`, one
   `vault-cli wearables activity list --from <date> --to <date> --limit 20 --format json`,
   or one routine record.
2. When connected-app tools are available, check the calendar. Call
   `murph.connected_apps_manage` once with unfiltered `action: list`. With
   exactly one active Google Calendar or Outlook account, find its read schema
   through `murph.connected_apps_search` and call `murph.connected_apps_execute`
   once for that account, that local date and that window. The connection
   already allows this narrow read, so do not ask permission. With no account
   or several, skip the calendar.
3. If evidence, an account or a tool is missing, unclear or fails, choose
   anyway and ask no timing question. The fallbacks are 09:00 for morning,
   14:00 for afternoon, 19:00 for evening and 12:00 otherwise.
4. Save one one-shot reminder inside the window (`schedule.kind: at` with
   `schedule.localAt`). The time is chosen once, now. Do not add
   `skip-when-busy`, availability or account bindings, calendar reads at run
   time, or rescheduling.
5. Keep what you looked at out of the reminder. Do not copy calendar or
   provider content into the instructions or `contextReferences`, and never
   reveal event titles, attendees, notes or account details.
6. In the reply, after the subject, date and time, give one true,
   privacy-safe reason for the time and say it can be changed.

### Offering a calendar connection afterward

After a broad-window reminder is saved, you may offer once to connect a
calendar, but only when the account list showed that none is connected. An
unclear or failed list is not evidence of that. Never start a connection
without a yes.

- Read memory first unless you already have it. Do not offer when
  Instructions contain `Never proactively offer calendar connection for
  reminder timing.`, or when a Context record beginning `Calendar connection
  offer for reminder timing —` has a `do not re-offer before` date of today or
  later.
- Before offering, record the offer. Update that Context record by id, or
  create it once with `vault-cli memory upsert` if it does not exist. Its exact
  text is `Calendar connection offer for reminder timing — last offered:
  YYYY-MM-DD; do not re-offer before: YYYY-MM-DD.`, using today and the date 14
  days later. Check the returned record. If the read or write fails, skip the
  offer and leave the reminder as it is.
- When the member asks to connect a calendar themselves, go ahead whatever the
  record says. When they ask never to be offered again, save the Instructions
  text above. For this one offer, the dated record decides when to offer
  again, even after an ordinary "no".

## Appointment reminders

When this conversation establishes a confirmed future appointment, make sure
exactly one one-shot reminder exists for it. If conversation or tool evidence
shows an existing reminder covers it, reuse or patch that one. A reminder alone
does not need the appointment-scheduling skill.

- Use the appointment's local timezone when known, otherwise the vault
  timezone. A reminder time the member chose overrides the defaults below.
- For a start before 10:00 AM, remind the evening before at the member's usual
  pre-bed time when known, otherwise 8:00 PM.
- For a start at 10:00 AM or later, remind at 8:00 AM that day.
- If the default time has passed, pick the latest future time that is still
  useful and leaves any known preparation or travel time. Never save a time in
  the past or after the appointment starts.
- Save no reminder for an appointment that is hypothetical, tentative,
  canceled or already over. When an appointment is clearly booked but its date
  or start time is missing, ask for that one detail.
- When a confirmed appointment is canceled or moved and you can identify its
  reminder, archive the reminder or patch its time.
- Mention the reminder only after its save and timing are confirmed.

## Wearable-data summaries

Wearable data can arrive three to six hours after the events it describes.
When you choose the time for a summary of a completed period, prefer the next
day after a buffer of several hours, otherwise late morning local time. Keep an
exact time the member asked for. If it risks partial data, say so briefly and
offer the later option. Do not move reminders tied to an action, such as a
bedtime reminder.

The stored instructions name the completed period and the metrics, count only
dates that have data, show coverage as counts such as "6 of 7 days", and never
treat a missing date as zero. Leave the reason for the timing and other data
caveats out of them.

## Outdoor and weather reminders

Before writing or running one, read
`$MURPH_ASSISTANT_SKILLS_ROOT/connected-apps/references/reading.md` and follow
its "Outdoor reminder location" section. It covers where the location comes
from, what the stored instructions say, and the weather read. Keep a
destination or time the member fixed.
