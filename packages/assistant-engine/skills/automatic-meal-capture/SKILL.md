---
name: automatic-meal-capture
description: Meals the Murph iPhone app imports from new food photos. Covers enriching them, merging or deleting duplicates, setup and missing-photo questions, and the nightly closeout.
---

# Automatic meal capture

The Murph iPhone app notices new food photos and saves each one as a meal: one
meal per photo, with the photo attached, `source: device`, the time the photo
was taken, and no foods, calories or macros yet. That meal is the log. Add
detail to it with `vault-cli meal edit`. Never run `meal add` for a photo that
already has a meal, because that creates a duplicate.

Two other files hold the rest:

- For "how do I track meals", app setup, what the app can see, or a photo that
  did not arrive, read
  `$MURPH_ASSISTANT_SKILLS_ROOT/automatic-meal-capture/references/setup.md`.
  You do not need the rest of this file for those questions.
- For the scheduled 9pm closeout, see the last section.

Lookups, estimating and the nutrition card are in
`$MURPH_ASSISTANT_SKILLS_ROOT/food-journal/SKILL.md`. Read it before
estimating. Members who should not see numbers, as that file defines them, get
no estimates and no questions asked only to make an estimate possible.

## When to enrich an imported meal

Enrich imported meals in three situations:

1. A meal save or a `meal totals` read shows a meal without nutrition for that
   date (a metric `mealCount` below the day's `mealCount`).
2. The member asks about a photo or a captured meal, or sends one from the app
   with Send to Murph. Send to Murph asks for an estimate now, so do not leave
   it for the closeout.
3. The nightly closeout.

Do not list meals before an ordinary meal log to look for imported ones. An
import by itself starts no turn and needs no reply, and nothing is enriched at
import time.

## Enrich one imported meal

1. **Find it.** Run
   `vault-cli meal list --from <YYYY-MM-DD> --to <YYYY-MM-DD> --limit 20 --format json`
   for the local date of the photo and pick out the meals that have a photo and
   no nutrition. `meal list` shortens fields, so read the full record with
   `vault-cli meal show <meal-id> --format json`. The photo's capture time sets
   the meal's time and day in the member's vault timezone. If travel or a
   timezone change could change which meal or day it was, say so.
2. **Check for a duplicate.** Compare the other meals near that time for a
   typed meal, a meal from a connected app, or a second photo of the same
   eating occasion. Count each occasion once. When you cannot tell whether two
   records are the same occasion, enrich one, leave the other, and ask only if
   the answer materially changes tracking.
3. **Look at the photo.** Open the attachment itself. The phone's classifier
   accepting an image tells you nothing about what is in it.
4. **Do exactly one of these.**
   - **Food you can estimate.** Edit the meal with ingredients and nutrition
     (step 5). Do not ask for confirmation. A visible food or drink with a
     defensible portion range is enough, even when the exact recipe is unknown.
   - **Food you cannot estimate.** If the note is empty, save a short `--note`
     describing what is visible and what is uncertain, and add `--ingredient`
     only for what the photo shows. Ask one narrow identity or portion question
     only when no meaningful estimate is possible and the answer would help.
   - **A non-food image, or food the member did not eat.** Run
     `vault-cli meal delete <meal-id>`, then confirm it is gone with a fresh
     `meal list` for that date. Write no note and run no `remove-photo`.
   - **A repeat of a meal already saved.** If the saved meal was typed, merge
     the two as described under "Merge a capture into a typed meal". Otherwise,
     while the capture's attachment role is still `photo`, delete the capture
     as above.
   - **The capture has a note the member wrote.** Never delete it. Keep the
     record and the note, add no invented dish, ingredients or nutrition, and
     read it back.

   Delete only after looking at the photo. An image that is hard to estimate
   stays a meal.
5. **Edit.**
   `vault-cli meal edit <meal-id> --name "<dish name>" --ingredient "<food>" --ingredient "<food>" --nutrition-calories <kcal> --nutrition-protein-grams <g> --nutrition-carbs-grams <g> --nutrition-fat-grams <g> --nutrition-fiber-grams <g> --nutrition-source <label|database|estimated> --nutrition-confidence <low|medium|high> --nutrition-source-detail "<evidence and assumptions>" --format json`.
   Use `label` for verified label facts, `database` for matched database rows,
   and `estimated` for ingredients or portions judged from the photo. With
   mixed evidence, describe both in the source detail and set confidence from
   the weakest material assumption. Look up a visible package or menu item when
   its identity changes the estimate. Leave the meal's time as it is.
6. **Read it back** with `meal show` before saying it was logged. An edit
   makes the meal member-owned, so `source` reads `manual` afterward; its
   `externalRef` still identifies the capture.
7. **If the edit fails, or the read-back does not show what you saved,** run
   one fresh `meal list` for the capture date, find the same capture again by
   its id, time and attachment, and retry `meal edit` once with corrected
   arguments. If that also fails, leave the photo in place and say the meal is
   still unresolved. Do not switch to `meal add` or edit a nearby record.
8. **Totals and card.** `meal edit` has no `--with-daily-totals` flag. Follow
   "Changing a meal that already exists" in `food-journal/SKILL.md` for fresh
   totals and the card.

## Merge a capture into a typed meal

When a capture still waiting for review repeats a meal the member typed, keep
one entry and keep the photo on it. This applies when the typed meal has no
attachment and no `externalRef`, has the same local date as the capture, and
the capture has no note the member wrote.

1. Read the typed meal with `meal show`.
2. Copy its name, note, ingredients, tags and nutrition onto the capture with
   `vault-cli meal edit <capture-meal-id>`, then read the capture back and
   compare.
3. Run `vault-cli meal delete <typed-meal-id>` and confirm it is gone.

If the delete fails, run no `remove-photo`, so the capture stays pending. A
later run that finds those details already on the capture starts again at step
3. If the typed meal holds something `meal edit` cannot set, such as
micronutrients, keep the typed meal and delete the capture.

## When the photo is no longer available

Full photos expire 90 days after capture. A smaller copy, the `photo_thumbnail`
attachment, stays as long as the meal exists. Use the thumbnail through the
normal media tools when the full photo is gone. It is the same photo and does
not mean a new meal. Deleting a meal removes its thumbnail and any remaining
full photo.

If a captured meal still lacks the identity, amount or nutrition that the
member's request needs, and no usable photo is left, complete it from what the
member tells you. Find the meal with `meal list` and `meal show` by its capture
date, capture time and `externalRef`, edit it, read it back, and then use fresh
totals. Never add a replacement meal, restore the photo, or work out totals
that leave the meal aside. Ask the member only when no meaningful estimate is
possible.

## Run the automatic 9pm closeout

On a scheduled closeout run, read
`$MURPH_ASSISTANT_SKILLS_ROOT/automatic-meal-capture/references/closeout.md`
and follow it exactly. It is the single owner of that workflow.
