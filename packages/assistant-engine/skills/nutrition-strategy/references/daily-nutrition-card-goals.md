# Daily nutrition targets

Read this file when a member asks to set or change their saved daily targets for calories, protein, carbohydrate, fat or fiber, or when they reply to a target proposal you made. Showing totals or a nutrition card never needs this file; the card tool and `food-journal` cover that.

These rules hold throughout:

- Only an explicit request to set targets starts this workflow. A meal log, a request for totals or a card, and a scheduled check-in or closeout do not. A scheduled turn never asks target questions and never creates, changes, repeats or activates a proposal.
- A proposal stays paused until the member accepts it after you have explained it. Silence, a meal reply, accepting a reminder and asking for totals are not acceptance. A decline stands until the member asks for targets again.
- The card tool description says when numeric guidance is unsuitable for a member. When it is, write no Goal and no measurement, leave any existing paused proposal as it is, and reply helpfully without numbers.
- Use the card's date throughout: the date the member asked about, or the occurrence date the engine supplies. Never substitute today's wall-clock date.

## 1. Read current targets

Run `vault-cli meal totals --from <date> --to <same-date> --resolve-goals --format json` for the card's date. You may instead reuse `dailyTotals.data` from a successful same-date `meal add --with-daily-totals` or `meal import-json --with-daily-totals` when `dailyTotals.status` is `available`. The `goalContext` in that result is the answer about active targets. It has already applied the date, unit, comparator and conflict rules, so do not re-derive it from `goal list` or `goal show`. Rerun the read after any meal or Goal change.

- `ready`: all five targets are set. Derive nothing unless the member asked to change a target Murph proposed earlier.
- `missing`: one or more targets are unset. `goalContext.targets.<metric>.status` shows which metrics are `resolved` and which are `missing`. Keep every resolved value fixed and derive only the missing ones.
- A target Murph proposed has a `provenance.targetId` that starts with `murph-default-`. Any other resolved target is the member's own.
- `conflict`, `incompatible` or `capacity`: the member has targets this workflow cannot combine, such as a range, another unit or two Goals that set the same metric. Write no Goal and attach no card. Say in plain words what you found and ask which target they want to keep.

A target the member or their clinician set always wins for its metric. Do not replace it, average it with another value or save a default over it.

Before asking the member for inputs, read what Murph already has: goals, body measurements, training, weight trend, activity and the direction `body-composition` set (maintenance, gain or loss). Do not infer sex from a name, pronouns or a gender label, and do not infer usual activity from a few workouts or one day of wearable data. If inputs are still missing, ask for them in one question. Save nothing until you have a responsible calorie estimate and five targets that fit together.

## 2. Derive the missing targets

Keep population guidance and Murph's own judgment separate when you explain the result.

**Calories.** Prefer a representative measured total energy expenditure, or a usual intake the member confirms held their weight stable for several weeks at their usual activity. Otherwise, for adults 19 and older, use the 2023 National Academies estimated energy requirement equations. They need age in years, height in cm, weight in kg, the sex the member supplies for this calculation, and a representative activity category.

- Men, inactive: `753.07 - 10.83*age + 6.50*height + 14.10*weight`
- Men, low active: `581.47 - 10.83*age + 8.30*height + 14.94*weight`
- Men, active: `1004.82 - 10.83*age + 6.52*height + 15.91*weight`
- Men, very active: `-517.88 - 10.83*age + 15.61*height + 19.11*weight`
- Women, inactive: `584.90 - 7.01*age + 5.72*height + 11.71*weight`
- Women, low active: `575.77 - 7.01*age + 6.60*height + 12.14*weight`
- Women, active: `710.25 - 7.01*age + 6.54*height + 12.34*weight`
- Women, very active: `511.83 - 7.01*age + 9.07*height + 12.56*weight`

The result is a starting estimate. Then apply the direction:

- Maintenance or recomposition: use it unchanged.
- Muscle gain: add about 5 to 10%.
- Fat loss: subtract about 10 to 20%, and never start with a deficit larger than about 500 kcal a day.

These adjustments are Murph's judgment, informed by limited athlete research. Round the final target to the nearest 100 kcal and tell the member it will be adjusted from the multi-week weight trend, training, hunger and recovery. If the adjusted or rounded target is below 1,200 kcal a day, stop. Do not raise it to 1,200, save a Goal or attach a card with targets.

**Protein.** Use about 1.6 g/kg/day for a healthy adult who does regular resistance training or wants to gain muscle, about 1.4 g/kg/day for other adults who exercise regularly, and 0.8 g/kg/day for a healthy adult who does not exercise, when body weight is a sensible reference. Round to the nearest 5 g. This is the preferred value when protein is one of several missing macros. It never overrides a resolved target or the energy check below.

**Carbohydrate and fat.** Hold the calorie target and every resolved macro fixed. Count 4 kcal per gram for protein and carbohydrate and 9 kcal per gram for fat. The adult acceptable ranges are protein 10 to 35% of energy, fat 20 to 35% and carbohydrate 45 to 65%.

- One macro missing: give it the remaining energy.
- Protein and one other macro missing: start from the protein value above, then move it to the nearest value inside 10 to 35% that leaves the other missing macro inside its range.
- Fat and carbohydrate both missing: choose the fat share closest to 30% of energy, or closest to 25% when running or other endurance training is a large part of the member's week. Carbohydrate takes the rest.
- All three missing: set protein first, then fat and carbohydrate.

Round each derived macro to the nearest 5 g and recompute once. The bundle is valid when every resolved value is unchanged, each macro is inside its range, and `4*protein + 4*carbohydrate + 9*fat` is within 50 kcal of the calorie target. Do not reapply the percentage defaults after a resolved value has used part of the energy. If the remaining energy is negative, no value fits, or rounding breaks a range or the 50 kcal check, write nothing. Explain the clash and ask which of their own targets the member wants to change.

Example: with 2,000 kcal, 150 g protein and 250 g carbohydrate already set, fat is the only missing macro. The remaining energy gives about 44 g, which rounds to 45 g. The macros total 2,005 kcal and all three shares are in range, so the bundle is valid. With 300 g carbohydrate instead, the remaining fat falls below 20% of energy, so no bundle fits and nothing is written.

**Fiber.** Use 14 g per 1,000 kcal, rounded to the nearest 5 g. This is the adult reference figure and not a prescription for a digestive condition.

## 3. Save the proposal as a paused Goal

1. Find Murph's managed Goal in any status. Run `vault-cli goal list --limit 200 --format json`, then `vault-cli goal show <id>` on the candidate. This lookup is separate from the read in step 1, and neither replaces the other. If the list returns 200 Goals, or you cannot tell which Goal owns a metric, write nothing and attach no card.
2. Reuse the one Goal with slug `murph-daily-nutrition-starting-targets`. A paused Goal is a proposal waiting for the member. An abandoned or completed Goal means the member opted out, so do not recreate it unless they ask.
3. Create the Goal only when it is absent, with `vault-cli goal import-json --input -`: title `Daily nutrition targets`, domain `nutrition`, horizon `ongoing`, status `paused`, and `window: { startAt: <effective date> }`. The effective date is the date the member asked the targets to start. Without one, use the card's date for a dated card request, and otherwise the engine-supplied current vault-local date. Always set `startAt` yourself.
4. Save only metrics the member has not set themselves. Each target has `kind: "metric"`, `evaluation.kind: "selected-value"`, comparator `between`, and the same number in `value` and `highValue`. Use these target ids, metrics and units:
   - `murph-default-dietary-calories`: `dietary-calories`, `kcal`
   - `murph-default-protein-grams`: `protein-grams`, `g`
   - `murph-default-carbs-grams`: `carbs-grams`, `g`
   - `murph-default-fat-grams`: `fat-grams`, `g`
   - `murph-default-fiber-grams`: `fiber-grams`, `g`
5. On every later update, reuse the same Goal id and target ids. `metricTargets` replaces the stored array, so always send the complete array you want the Goal to hold afterward. Leave out a metric only when the member now has their own target for it.
6. Leave `window` out of later updates so the original start date is kept. Change it only when the member asks for a different effective date, and tell them you did.
7. Any update that adds or changes a derived value must also set `status: "paused"`, even if the Goal was active. The revised bundle is a proposal again until the member accepts it. An update that only removes a metric the member now owns can leave the Goal active. A status-only update can omit `metricTargets`.
8. After every write, run `vault-cli goal show <goal-id>` and check the complete target set, the status and the unchanged window before you tell the member anything.

## 4. Explain it in text

A turn that creates or changes the proposal replies in ordinary text and attaches no card. Name all five values, the facts and assumptions that drove them, and briefly why each landed where it did. State the effective date, especially when it is in the past or the future. Call the values provisional and invite the member to correct or accept them.

## 5. Accept, change or decline

- Accept: check suitability again. If numeric guidance is now unsuitable, leave the proposal paused and reply without numbers. Otherwise repeat the read in step 1. If the member has since set their own target for a metric, remove that metric from the managed Goal by sending the complete remaining array, and read the Goal back. Then run `vault-cli goal save "Daily nutrition targets" --id <goal-id> --status active` and read the Goal back.
- Change: when the member changes a value, or a metric needs a new derived value because the member's own target went away, send the complete array with `status: "paused"` through `goal import-json`, explain the revision briefly and wait for acceptance.
- Decline: update the same Goal to `abandoned`.

Do not recalculate accepted values later without being asked. If the member sets their own target for a metric after activation, remove that metric from the managed Goal by sending the complete remaining array. Never edit the member's own Goal.

## 6. The first card with targets

When the member's request to set targets also asked for a card, the reply to a clear acceptance may attach exactly one card. Do this only after suitability passes, the Goal is active and read back, and you have re-read the same-date totals, and only when the card alone completes the request. A request that was only about targets, a correction, a decline, an unclear acceptance or a request with several parts gets ordinary text.

On later turns, attach a card with targets only when the read in step 1 returns `ready`, and use the resolved values as returned. An ordinary card request never repeats a paused proposal. When targets are missing it shows totals only and changes no Goal.
