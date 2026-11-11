# Saved meal and nutrient reads

Read this to recall recent meals, review a saved day, or answer a question
about stored or connected nutrients. Logging a new meal does not need it. To
estimate, correct or log a meal, or to attach a nutrition card, read
`food-journal/SKILL.md`.

For members who should not see numbers (see `food-journal/SKILL.md`), leave
calories and macros out of the answer. Keep a symptom or digestion question on
that question.

## Counts, coverage and stored calorie or macro totals

Use `vault-cli meal totals --from <date> --to <date> --format json` for meal
counts, days with food logs, daily calorie and macro totals, averages and
comparisons. Its `days` array has each logged date, that day's `mealCount`, and
each metric's total with the `mealCount` that contributed to it. One read
usually answers the question. List individual meals only when the question
needs food names, sources or other detail the totals lack.

How to read the result:

- A date that is missing has no saved meals. The member may still have eaten.
- A null metric with zero contributing meals is unknown. Never report it as
  zero.
- Fewer contributing meals than the day's `mealCount` means a partial total.
- Equal counts mean every saved meal has that value. Meals the member never
  logged are still missing.
- For an average, say what you divided by: logged days, or days that have the
  requested value. Do not count unknown days as zero or present a partial-day
  average as complete intake.

For target-setting or advice, read `nutrition-strategy`. Do not infer targets
from these totals.

## Recent meals and saved days

Read the saved records before asking the member to repeat a meal or saying it
is unknown.

- The latest saved meal:
  `vault-cli timeline --entry-type event --kind meal --limit 1 --format json`.
  The timeline is newest first. `meal list` is oldest first, so
  `meal list --limit 1` does not find the latest meal. Add the member's date
  bounds when they give them.
- One day's meals:
  `vault-cli meal list --from <date> --to <same-date> --limit 50 --format json`.
  `meal list` has no `--date` option. Check whether the result was cut off
  before saying the list is complete.
- Open a returned meal with `vault-cli meal show <meal-id> --format json`, and
  look at its photo when you need it to identify the food. An empty attachment
  list in the chat does not mean there are no imported meal photos.

Tell the member which of three things happened: nothing was saved, the read
failed, or a photo exists but the food cannot be identified. Reuse reads you
already made this turn.

## Connected carbohydrate records

Use one day or a short range:
`vault-cli measurement entry list --metric carbohydrates --from <date> --to <date> --limit 50 --format json`.
The grams returned are partial intake evidence. Do not infer the food, a
complete meal, the day's total carbohydrate, or calories from them. If no entry
comes back, say none was recorded.

## Vitamins, minerals and water

Use one day or a short range:
`vault-cli meal nutrients --from <date> --to <date> --format json`.
The response lists every supported nutrient.

- A `null` total with zero contributing meals means no recorded value. Never
  report it as zero.
- A `contributingMealCount` below the enclosing `mealCount` means the total is
  partial. Do not extrapolate the missing meals.
- Equal counts mean every saved meal supplied that value. Meals the member
  never logged are still missing.
- The totals can mix meals from a connected app with meals logged in Murph. Do
  not credit them to one provider, or call that provider complete, without
  separate evidence.
- These are sums of stored meal values. The source app's own targets, daily
  percentages and completeness claims are not imported.

When the member asks what is "low", report the observed total and its coverage
first. Call an intake low, adequate, deficient or excessive only when a
trustworthy target applies to this member and the stored unit and nutrient form
match it, and name the target and the remaining uncertainty. For a reference
comparison, use a current authoritative source and get the age, sex, and
pregnancy or lactation context that source needs. Do not compare stored folic
acid, vitamin A, vitamin E or niacin values with DFE, RAE, alpha-tocopherol or
niacin-equivalent targets unless the imported form and conversion basis are
known. One day of food records does not diagnose a deficiency.

Read `nutrition-strategy` for food-first suggestions and
`micronutrients-supplements` for labs, supplement dosing or deficiency-risk
questions.
