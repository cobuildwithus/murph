# Saved meal and nutrient reads

Read this for recent-meal recall, a saved-day review, or a connected or
saved-meal nutrient question. New meal capture does not need it.

## Recent meals and saved days

For private recent-meal recall, read canonical records before asking the member
to repeat the meal or claiming it is unknown. For the latest saved meal, use
`vault-cli timeline --entry-type event --kind meal --limit 1 --format json`:
the timeline is newest first by occurrence/capture time. `meal list` is oldest
first, so `meal list --limit 1` does not find the latest meal. Apply the member's
date bounds when given. Inspect the returned meal with `meal show` and view its
photo when identification requires it; an empty chat attachment list does not
mean there are no imported meal photos. Distinguish an empty result, a failed
read, and a photo whose food cannot be identified. Reuse relevant reads already
completed this turn.

When the member asks to
inspect a particular day's saved meals, use
`vault-cli meal list --from <date> --to <same-date> --limit 50 --format json`
and check for a truncated result before claiming complete coverage. `meal list`
has no `--date` option.

## Connected and saved-meal nutrients

For a connected carbohydrate-record question, use one bounded day or
short-range read:
`vault-cli measurement entry list --metric carbohydrates --from <date> --to <date> --limit 50 --format json`.
Returned grams are partial intake evidence. Do not infer food identity, a
complete meal, total daily carbohydrate, or eaten calories from them. With no
returned entry, say none was recorded.

For a connected or saved-meal vitamin, mineral, or water question, use one
bounded day or short-range read:
`vault-cli meal nutrients --from <date> --to <date> --format json`.
The response lists every supported nutrient field. A `null` total with zero
contributing meals means no recorded value; never report it as zero. A `contributingMealCount` below
the enclosing `mealCount` means the total is partial across the selected stored
meals; do not extrapolate the missing meals. Equal counts mean every selected
stored meal record supplied that field, not that every meal eaten that day was
logged. The aggregate may combine connected and manually saved meals. Do not
attribute its totals or coverage to one provider or claim that provider was
complete unless separate provider-specific evidence establishes that.

Treat this as a bounded sum of stored meal fields, not a copy of the source
app's daily dashboard. Source-app targets, daily percentages, and completeness
claims are not imported. When asked what is "low," report the observed total and
coverage first. Do not call an intake low, adequate, deficient, or excessive
unless a trustworthy target applies to this member and the stored unit and
nutrient form are compatible with it; name the target basis and remaining
uncertainty. If the member asks for a reference comparison, use a current
authoritative source rather than a remembered target and obtain the age, sex,
and pregnancy or lactation context needed for that source. Do not directly
compare provider fields for folic acid, vitamin A, vitamin E, or niacin to DFE,
RAE, alpha-tocopherol, or niacin-equivalent targets unless the imported form and
conversion basis are known. One day of food records does not diagnose a
deficiency. Use
`nutrition-strategy` for food-first suggestions and
`micronutrients-supplements` for labs, supplement dosing, or deficiency-risk
questions.
