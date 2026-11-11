# After a verified order

Read this after the site has confirmed an order for a supplement or another
consumable health item, and before the final reply. It covers the reorder
check-in, logging a supplement, and what to remember from a browser run.

## Reorder check-in

After a verified order of a consumable health item that runs out, such as a
30-day supplement supply, daily contact lenses or weekly meal boxes, create one
check-in near the time it will run out. Do this without asking when the order
result or the member's request gives reliable evidence of how long the supply
lasts. It counts as the one next step you may offer after the task, so offer
nothing else unless the member asks.

Create it with `murph.automation`, following the automation rules in your
standing instructions:

- `schedule.kind: at` with `schedule.localAt.time`, `schedule.localAt.timeZone`
  and an explicit local `schedule.localAt.date`. Never use a raw `schedule.at`.
  Follow the automation tool's local-time recovery steps if the save fails.
- Leave `slug` out. Murph generates the identity.
- `continuityPolicy: "preserve"`
- `instructions`: ask whether the member wants Murph to reorder or adjust the
  item.

Pick a date about two days before the item should run out, counted from the
expected start or arrival date. If that date is unknown, count from the order
date and tell the member the check-in is approximate.

- If an equivalent reminder already exists, reuse it and create nothing new.
- If the supply length, the delivery route or the member's intent is unclear,
  offer the check-in and wait for their answer.
- Never reorder automatically.
- For prescription medications, clinician-directed supplies and
  safety-sensitive items, create a refill reminder only when the member asks
  for one.

## Logging a supplement

When a verified supplement order gives a reliable delivery date, save or update
the supplement with
`vault-cli supplement save "<name>" --started-on <delivery-date>`, keeping the
known brand, serving, dose and label ingredients. This is part of finishing the
order and needs no separate offer. When the delivery date is not reliable, ask
for it in one question or offer to log the supplement once it is known.

Buying a supplement does not show that it works, that it is safe, or that it
suits the member, and it does not change a dose. If the member accepts a plan
to track its effect, use the `experiment-onboarding` skill, and
`behavior-followthrough` when recurring support matters.

## What to remember from a run

This section does not apply to appointment work. The `appointment-scheduling`
skill says what may be saved from a booking.

After a browser run that was more than routine, save a memory only when the run
revealed a new, lasting fact that will make future tasks better for this
member.

1. Read memory first:
   `vault-cli memory show --compact --vault "$VAULT" --format json`
2. If a matching record exists, update it with
   `vault-cli memory update <memoryId> "<text>" --vault "$VAULT"`.
3. Otherwise add one short record with
   `vault-cli memory upsert "<text>" --vault "$VAULT" --section <section>`:
   - `Preferences` for a retailer, marketplace or direct choice, provider,
     location, delivery, meal service or one-time-purchase preference
   - `Instructions` for a standing rule the member stated, such as "never
     enroll me in autoship"
   - `Context` for a stable account or portal fact, or a verified quirk of a
     site that will recur

Good memories read like this:

- "Prefers Amazon for routine supplement reorders when the exact product is
  sold by the brand or a verified seller; otherwise prefers the brand's
  official store."
- "Never select subscriptions, autoship, memberships, or marketing opt-ins
  unless explicitly requested."

Save nothing for a routine success, a passing stock level or price, a temporary
page layout, a single appointment or order, or a guess. Never store passwords,
one-time codes, cookies, payment details, full addresses, insurance numbers,
prescription values, medical details, order numbers, appointment details,
handoff links, or text copied from a webpage, an email or a calendar event.

Memory is visible to the member and they can edit it. Keep everything in that
one place.
