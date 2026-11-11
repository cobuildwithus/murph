# Changing reminders, check-ins, and reviews on an existing plan

Read this before you add, change, pause, or stop support on a plan that already
has a habit regimen. For a brand-new plan, `goal-setup` has everything needed.

In a group chat, never read or change a participant's private reminders, plan,
memory, or preferences. Move personal changes to their private conversation.
In a group, act only on support the room itself owns.

## The three kinds of support

Each saved automation carries `supportKind`, which fixes what its message may
contain when it fires:

- `reminder`: a cue for the action. It never asks whether the member did it.
- `check_in`: one short question about how a specific session went.
- `review`: the end-of-week look at the plan and the decision to keep, change,
  pause, or stop.

Offer reminders and a review by default with a plan. Offer a check-in only when
the member asks for accountability, describes a commitment that has been hard to
keep, or asks you to check back; "remind me" covers the reminder alone. A
check-in and its reminder are separate automations, so the member can stop one
and keep the other.

One narrow exception needs no extra automation: `murph.automation` action
`attach_follow_up` attaches a single expiring follow-up to a private reminder
you are sending, when it would help and no saved preference forbids proactive
messages. The follow-up reads the current conversation when it fires, sends once
or stays silent, and cannot attach another.

## What the member's yes covers

Offer the change with its exact days and times. A clear yes covers exactly what
you named, so apply it in that turn without a second confirmation. If the member
edits the offer, apply the edited version. An unclear reply changes nothing.

A request to stop asking about a topic, ask less, pause check-ins, or stop
reminders is itself the instruction. Read the current support, then pause or
archive the narrowest matching automation and leave the rest alone. When nothing
matches, or the request is about future offers, save the member's words as a
Preferences memory so Murph does not raise the topic again, and remove it only
when they reopen the topic.

## Find what exists

```text
vault-cli automation list --support-series-id habit:<regimen-id> --compact --limit 200
```

Follow each `nextCursor` with `--cursor` until it is null. If you cannot get the
full list, change nothing and say so. Use `vault-cli automation show <automationId>`
only for a detail the compact list lacks. Decide membership from the series id,
never from a title or the reminder's text.

## Save and reconcile

Use `murph.automation`.

- Patch the automations that already match what is wanted and `save` only the
  missing ones. If everything already matches, write nothing.
- Every save or patch sets `supportSeriesId: "habit:<regimen-id>"`, the
  `supportKind`, and
  `contextReferences: [{"entityKind":"goal","entityId":"<goal-id>"},{"entityKind":"regimen","entityId":"<regimen-id>"}]`.
- Prefer finite one-shots:
  `schedule: {"kind":"at","localAt":{"date":"<YYYY-MM-DD>","time":"<HH:MM>","timeZone":"<IANA zone>"}}`.
  Use a recurring schedule only when the member asks for an ongoing reminder;
  it then runs until they pause or change it and needs no review attached.
- Finish with one `reconcile` call: the same `supportSeriesId` and
  `desiredAutomationIds` listing every automation that should remain. Anything
  else in the series is archived. An empty list archives the whole series,
  which is what a pause, a stop, or a plan with no reminders needs.

## What to write in the instructions

The regimen is the source of truth for the plan, so instructions describe the
message and leave the plan's details to the regimen. A reminder works out that
day's target from the regimen and the date. Keep titles neutral when the target
varies, and keep any date-specific exception the member asked for.

For a reminder: the cue in the member's everyday words, any tone or privacy note
they gave, when to skip (already done, plan paused, a safety condition they
named), and whether an image or voice memo is welcome.

For a check-in or review, add what the automation needs to judge the moment
without reading this skill: the standard, tiny, and fallback versions, the
action window, what evidence would show the session happened, what to do after
repeated misses, and whether the group may hear about it.

Leave out guilt, long read lists, health details in anything headed for a
shared chat, and any instruction to push harder after silence.

## Delivery around the member's calendar

End each automation's instructions with exactly one availability line.

`Availability conflict policy: fixed` is the default. Always use it for a time
the member dictated, for medication or clinician-directed support, and for
anything safety-critical.

Use `Availability conflict policy: skip-when-busy` only after the member agrees
to calendar-aware delivery for this support or as a standing preference. A
connected calendar alone is not agreement. First list the connected Google
Calendar and Outlook accounts. With none, keep the reminder fixed and offer the
connection. With more than one, keep it fixed until the member picks one. Then
add these two lines as well:

```text
Availability source policy: calendar-only
Availability calendar account: <toolkit> / <account-id>
```

Use the account's returned id. After saving, tell the member the reminder sends
normally until Murph's first background calendar check, usually within a day,
and that disconnecting the calendar can take up to a day to stop the skips.
