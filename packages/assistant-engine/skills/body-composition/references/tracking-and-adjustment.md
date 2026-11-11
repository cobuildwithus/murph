# Body composition: tracking and adjustment

Read this before setting up measurements, reviewing progress, calling a plateau or changing a plan.

## What to track

Choose one main outcome and one or two supporting signals. A member who does not want to weigh can use waist, clothing fit, performance or a marker agreed with their clinician.

| Goal | Main outcome | Supporting signals |
|---|---|---|
| Fat loss | Weight trend or waist trend | Strength or training quality; appetite, energy or steps |
| Muscle gain | Training performance or one circumference | Weight trend; waist, appetite or recovery |
| Recomposition | Waist or another circumference | Strength; weight trend |
| Maintenance | A broad weight or waist range | One habit or ability the member values |
| Unexplained change | Weight readings with source and time | Medications, illness, fluid, food, activity, cycle; symptoms |

## Measuring

- Weight: same scale, after waking and using the bathroom, before food, in similar clothing. How often is the member's choice. Daily, a few times a week and weekly all work, and not weighing at all is a valid choice when weighing is distressing.
- With frequent readings, summarize each week with either the mean or the median and keep the same method for every week you compare. With few readings, say that the trend is uncertain.
- Waist: same site, posture and time of day. Weekly or less often is enough.
- Photos are optional and private. Do not ask for them by default, do not require revealing clothing, and never share one to a group without the member's consent for that photo.
- Smart-scale body-fat, lean-mass and visceral-fat values are estimates. Keep the same device and conditions, use them only for a rough long-term direction that agrees with other signals, and do not join readings from different devices into one trend.

## Commands

- Read: `vault-cli measurement entry list --metric <metric> --from <date> --to <date> --limit 50 --format json`. A full page may leave out older readings, so narrow the dates or raise the limit before saying the history is complete.
- Record a reading the member reports: `vault-cli measurement add --metric weight --value <number> --unit <lb or kg> --source manual --occurred-at <YYYY-MM-DD>`. Use the same metric names the read returns, such as `weight` and `waist_circumference`.
- Keep units as recorded and compare only readings in the same unit.
- When a connected scale already supplies a reading, do not add a manual copy.
- Do not save a trend or a BMI you calculated as if it were a measurement, and do not keep a separate tracker file. The saved measurements and the Goal are the record.
- A body-composition goal uses `vault-cli goal save` once the member asks to set one up. `goal-setup` owns that flow.

## Reviewing progress

Report the time window and number of readings, the source when it matters, the weekly summaries at the start and the end, anything unusual in the period, one main reading of the trend with its uncertainty, and whether to hold, adjust, pause or involve a clinician. Do not present a fitted slope from a handful of readings.

## Calling a plateau

Wait for two to four weeks of comparable weight or waist data before calling a plateau. Wait longer for muscle gain in a trained lifter, around cycle-related fluid shifts, illness or travel, after starting creatine, or when readings are sparse. A flat scale with a smaller waist or rising strength is progress.

Before changing intake or activity, check in this order:

1. Was the plan actually doable, including weekends, restaurant meals, alcohol and drinks?
2. Did steps or training change?
3. Could salt, carbohydrate, constipation, soreness, sleep, cycle phase or a medication explain it?
4. Is waist, strength or another main outcome still improving?
5. Is the member near a sensible stopping point or due for a maintenance phase?

## Making an adjustment

An adjustment names the evidence window, the trend and its uncertainty, what you ruled out, the one thing that changes, the direction you expect, the next review date and what would make you reverse it. Ask the member before Murph updates a goal, a target, a check-in or a reminder.

Example: "Across three comparable weeks, weight and waist are flat, training is steady and the restaurant change happened most weeks. Trim the evening snack portion or add a short walk after lunch, one of the two, and review in two weeks."

Never turn an incomplete food log into a claim that the member ate a specific surplus or deficit.

## Groups

In a group, do not include a member's weight, waist, calories, photos or body commentary without their consent, and never rank people by weight lost, calories, thinness or body fat. For a group challenge, prefer behaviors or abilities the participants choose, and follow `group-challenge` for consent.
