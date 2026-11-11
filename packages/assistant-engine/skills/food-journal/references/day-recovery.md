# Completing a day that has a meal without nutrition

Read this when a meal save or a `meal totals` read shows a metric `mealCount`
below the day's top-level `mealCount`. One or more meals saved for that date
have no nutrition, so the day's card would be partial. Complete those meals
first, then attach the card. This applies in a private conversation during meal
logging, an app submission, and a card or daily-summary request. Keep every
read to the one date in question.

For members who should not see numbers (see `food-journal/SKILL.md`), skip
this recovery and do not ask a question whose only purpose is to make an
estimate possible.

1. **Find the meals.** Run
   `vault-cli meal list --from <date> --to <date> --limit 200 --format json`,
   then `vault-cli meal show <meal-id> --format json` for each meal that lacks
   nutrition.
2. **For a meal the iPhone app imported** (a photo with no nutrition yet), read
   `$MURPH_ASSISTANT_SKILLS_ROOT/automatic-meal-capture/SKILL.md` and follow
   it. It covers looking at the photo, enriching, merging a duplicate and
   deleting a non-food capture.
3. **For any other meal, estimate from what you have.** Use this conversation,
   the meal's saved name, ingredients and amount, and the lookup and estimating
   rules in `food-journal/SKILL.md`. You may copy totals from an earlier meal
   when the member says it was the same meal, or when the two share saved
   ingredients and portion. A similar name alone is not enough. Read the earlier
   meal with `meal show` before copying, save with
   `--nutrition-source inherited`, and name the earlier meal's source in
   `--nutrition-source-detail`.
4. **Edit the existing meal.**
   `vault-cli meal edit <meal-id> --nutrition-calories <kcal> --nutrition-protein-grams <g> --nutrition-carbs-grams <g> --nutrition-fat-grams <g> --nutrition-fiber-grams <g> --nutrition-source <source> --nutrition-confidence <confidence> --nutrition-source-detail "<evidence>" --format json`.
   Never add a replacement meal, and never work out totals that leave the
   incomplete meal aside.
5. **Read back and refresh.** Run `meal show` for the edited meal, then
   `vault-cli meal totals --from <date> --to <date> --resolve-goals --format json`,
   and attach the card as `food-journal/SKILL.md` describes.

Ask only when no meaningful estimate is possible. If a meal's identity or
amount is still too unclear after step 3, ask one short question for that
missing detail and end the turn without a card. When the member answers, resume
at step 4.

Attach a partial card only when the member, knowing some meals are missing
nutrition, asks to see what is there so far.

A complete day means every saved meal has nutrition. The member may have eaten
meals they never logged, so describe the card as nutrition logged so far.

The nightly closeout is a scheduled run and follows
`automatic-meal-capture/references/closeout.md`, which allows a narrower
question than this file does.
