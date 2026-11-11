# The automatic 9pm closeout

This is a scheduled run. It reviews the meal photos the iPhone app imported,
marks them reviewed, and sends the member one closeout for the day. Read
`automatic-meal-capture/SKILL.md` for how to handle one imported meal and
`food-journal/SKILL.md` for lookups and estimating.

A scheduled closeout never creates, changes, proposes or accepts a nutrition
goal, never asks about goals, and never invites goal setup.

## 1. Get the work

Use the engine-supplied `Occurrence local date` from the `Scheduled occurrence
context` as the working date, even when the wall-clock `Today's date` differs.
Run:

`vault-cli meal closeout-work --occurrence-at <scheduled-occurrence-instant> --to <occurrence-local-date> --limit 20 --format json`

It returns two things. First, meals that an earlier attempt at this same
occurrence already reviewed, shown by `photoReviewedAt`. Second, the oldest
captures still waiting for review, which are the ones whose attachment role is
`photo`. Those pending photos are the whole queue. Photos already reviewed and
thumbnails are not work.

## 2. Handle each pending capture

For each one, run `vault-cli meal show <meal-id> --format json`, look at the
photo, and follow "Enrich one imported meal" in
`automatic-meal-capture/SKILL.md`: enrich it, save a note of what is visible,
merge it, or delete it. Compare nearby meals first so one eating occasion is
counted once.

For a meal an earlier attempt already reviewed, use only its saved fields. A
confirmed delete finishes that capture. On a retry, refresh the queue, skip
meals that are already gone, and never recreate or delete them again.

## 3. Mark each surviving meal reviewed

Do this only after the read-back shows saved nutrition, the note of what is
visible, or a preserved member note, and after any merge delete has succeeded.

Run `vault-cli meal remove-photo <meal-id>`, then `meal show` again and check
that no attachment with role `photo` remains. Despite its name, this command
keeps the photo. It marks the attachment `reviewed_photo` and records
`photoReviewedAt`.

Any command failure, including a failed delete, fails the run. A retry picks up
the remaining pending photos together with the meals already reviewed for this
occurrence, so no meal is lost.

## 4. Separate today's captures from older ones

A capture belongs to today when its local capture date equals the occurrence
local date. A late import from an earlier date gets the full cleanup above and
nothing more: it never appears in a card, a question or the closeout text.
Deleted captures and kept non-food records stay out of the text as well.

If no remaining capture has the occurrence local date, return
`{"kind":"skip","privateSummary":"Historical meal cleanup completed."}` and
stop here.

## 5. Decide whether numbers are allowed

For a member who should not see numbers, as `food-journal/SKILL.md` defines,
finish the cleanup and send the ordinary closeout without numbers. Ask
nothing, read no totals and attach no card. Decide this from what is already
known about the member. Run no medical checklist. A limit that affects target
advice does not by itself hide ordinary logged totals.

## 6. The one question a closeout may ask

If one or more of today's captures still cannot be estimated at all after
cleanup, send one short question about those meals only. Ask for the missing
food and amount, refer to each meal by its local time, show no meal ids, and
stop before totals or a card. The member's answer arrives as an ordinary chat
turn and is handled by `automatic-meal-capture/SKILL.md`. A closeout asks no
other question. If a different meal that day lacks nutrition, send the ordinary
closeout and ask nothing.

## 7. Read the day's totals

Run:

`vault-cli meal totals --from <occurrence-local-date> --to <occurrence-local-date> --resolve-goals --format json`

This read applies every goal rule itself, so do not run `goal list` or
`goal show`. Read it once. Run it again only if a meal or goal changed
afterward. Never work out nutrition yourself or reuse totals from an earlier
turn. A missing value is unknown and is never zero.

`goalContext.status` decides what happens next:

- `ready`: attach the card with the five returned targets, as long as the read
  includes a calorie total. The runtime labels a partial total as partial.
- `missing`: attach the card with all five goals null, but only when all five
  nutrients have a total and each metric's `mealCount` equals the day's
  `mealCount`.
- `conflict`, `incompatible` or `capacity`: send the ordinary short closeout
  text with no card.

When there is no calorie total, or a `missing` day is incomplete, send the
ordinary short closeout text with no card.

## 8. Attach the card and return

Call `murph.attach_response_card` with:

```
card: {
  kind: "daily_nutrition", version: 2,
  localDate: <occurrence-local-date>,
  mealCount: <top-level mealCount>,
  totals: { calories, proteinGrams, carbsGrams, fatGrams, fiberGrams },
  goals:  { calories, proteinGrams, carbsGrams, fatGrams, fiberGrams }
}
```

Copy each metric's `{ total, mealCount }` pair unchanged from the totals read,
fiber included. For `missing`, every goal entry is null. For `ready`, each goal
entry is `{ target: <goalContext.targets.<metric>.target>, status: <any valid status> }`,
and the host replaces the status with its own assessment. Use the returned
targets exactly as they are. Never mix real targets with nulls.

After the card attaches, return a `send_message` decision whose text contains
no nutrition values. The runtime replaces that text with the closeout derived
from the card, so do not write a second summary. Without a card, return the
ordinary short closeout text. Never attach the photos, and do not mention
images, internal paths or the automation.

A member's reply to the closeout is an ordinary chat meal turn. It follows
`food-journal/SKILL.md` and never accepts goals.
