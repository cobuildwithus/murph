# Daily nutrition-card goals

Use this only after an explicit interactive request to set nutrition targets or
to receive a numeric daily nutrition card when the member does not already have
one complete, unambiguous daily target for calories, protein, carbohydrate,
fat, and fiber. A scheduled closeout may use an already accepted active bundle,
but it must not use this workflow to ask for inputs, derive or save targets, or
surface a proposal.

Before using this workflow, read and apply `daily-nutrition-card-safety.md`. If
its card-time gate suppresses numeric goals, stop here and keep the owning
non-numeric or clinical path.

## Target authority

- Read already-known goals, body measurements, training, weight trend, activity,
  and stated body-composition direction before asking. Never infer a missing
  physiological sex input from a name, pronouns, or gender label, and never infer
  usual activity from a few workouts or one wearable day.
- A member- or clinician-chosen active target always wins for its metric. Do not
  replace it, average conflicts, or create a default over it. A range or dynamic
  target cannot be collapsed into the card's scalar target; ask one narrow
  question or use ordinary text instead.
- A selected-value target is scalar when its comparator is `<`, `<=`, `>`, or
  `>=` using `value`, or `between` with identical `value` and `highValue`.
  Multiple active explicit owners or any other target shape is ambiguous.
- After explicit interactive target-setting intent, if one consolidated question
  can collect the genuinely missing inputs, ask it once. Until a responsible
  calorie estimate and all five goals exist, save no active defaults and attach
  no card.

## Derive a conservative proposal

Keep population guidance separate from Murph's product judgment.

1. **Calories.** Prefer representative measured total energy expenditure, or a
   member-confirmed usual intake that coincided with a stable multi-week weight
   trend and usual activity. Otherwise, for adults 19 and older, use the 2023
   National Academies EER equation only when age, height in centimeters, current
   weight in kilograms, the physiological sex input supplied for this
   calculation, and a representative physical-activity category are known:

   - Men: inactive `753.07 - 10.83*age + 6.50*height + 14.10*weight`; low active
     `581.47 - 10.83*age + 8.30*height + 14.94*weight`; active
     `1004.82 - 10.83*age + 6.52*height + 15.91*weight`; very active
     `-517.88 - 10.83*age + 15.61*height + 19.11*weight`.
   - Women: inactive `584.90 - 7.01*age + 5.72*height + 11.71*weight`; low active
     `575.77 - 7.01*age + 6.60*height + 12.14*weight`; active
     `710.25 - 7.01*age + 6.54*height + 12.34*weight`; very active
     `511.83 - 7.01*age + 9.07*height + 12.56*weight`.

   Treat the result as a starting estimate, not a measured requirement. Use it
   unchanged for maintenance or recomp. For an explicit muscle-gain direction,
   start conservatively around 5-10% above maintenance; for an explicit fat-loss
   direction, start around 10-20% below maintenance and do not begin with a
   deficit larger than about 500 kcal/day. These adjustments are Murph product
   judgment informed by limited athlete literature, not DRI prescriptions.
   Round the final target to the nearest 100 kcal and plan to adjust from a
   multi-week trend, training performance, hunger, and recovery.
2. **Protein.** For a generally healthy adult with regular resistance training
   or a muscle-gain goal, start near 1.6 g/kg/day. Use about 1.4 g/kg/day for
   other regularly exercising adults and 0.8 g/kg/day for a generally healthy
   non-exercising adult when weight is a responsible reference. Round to the
   nearest 5 g. Reject a result outside the adult 10-35% protein AMDR rather
   than forcing the arithmetic.
3. **Fat and carbohydrate.** After protein, start fat near 30% of calories and
   assign carbohydrate the remaining energy, using 4 kcal/g for protein and
   carbohydrate and 9 kcal/g for fat. Keep carbohydrate within the adult
   45-65% AMDR and fat within 20-35%; favor carbohydrate within that range when
   running or other endurance demand is material. Round each to the nearest 5 g
   and recheck the energy total. Never bend an explicit target to make the
   bundle add up.
4. **Fiber.** Start from the adult reference density of 14 g per 1,000 kcal and
   round to the nearest 5 g. This is population guidance, not a personalized
   gastrointestinal prescription.

## Save once, explain, then activate

Use the existing canonical Goal owner; add no new state surface.

1. Run `vault-cli goal list --limit 200 --format json`, then show only candidate
   records. If the list is saturated or target authority is ambiguous, do not
   write or attach a card.
2. Reuse at most one Goal with slug `murph-daily-nutrition-starting-targets`.
   Create it only when absent, with title `Daily nutrition targets`, domain
   `nutrition`, horizon `ongoing`, and status `paused`. A paused record is the
   proposal awaiting the member's review; an abandoned or completed record is
   an opt-out and must not be recreated automatically.
3. Save only metrics without an explicit owner through
   `vault-cli goal import-json --input -`. Each point target uses `kind: "metric"`,
   `evaluation.kind: "selected-value"`, comparator `between`, and identical
   `value` and `highValue`. Use these stable target ids and metric/unit pairs:

   - `murph-default-dietary-calories`: `dietary-calories`, `kcal`
   - `murph-default-protein-grams`: `protein-grams`, `g`
   - `murph-default-carbs-grams`: `carbs-grams`, `g`
   - `murph-default-fat-grams`: `fat-grams`, `g`
   - `murph-default-fiber-grams`: `fiber-grams`, `g`

   Reuse the same Goal id and stable target ids on every update. Supplying
   `metricTargets` replaces that Goal's stored array; every edit or overlap
   removal must therefore send the complete intended post-update array for the
   managed Goal. Preserve every unchanged target and stable target id, and omit
   only a metric deliberately removed because an explicit owner now exists.
   Never send only the changed or removed target. Read the Goal back and verify
   the complete retained set; never create a duplicate or rewrite an unchanged
   proposal. Any write that adds or changes a derived managed value must include
   `status: "paused"` atomically, even when the same Goal was active; this keeps
   the revised bundle a proposal until the member accepts it. Removing an
   overlapping metric without adding or changing a derived value may leave the
   managed Goal active because the explicit owner supplies that metric. A
   status-only update may omit `metricTargets`.
4. A turn that creates or changes the paused proposal must be ordinary text,
   never a card. Briefly name all five effective values, which facts and labeled
   assumptions materially drove them, and why calories, protein, carbohydrate,
   fat, and fiber landed there. Call them provisional and invite correction or
   acceptance. This explanation must happen before the first goal-aware card.
5. When the member accepts the proposal, first re-read target authority. If a
   metric has gained an explicit owner, remove it from the managed proposal by
   sending the complete intended post-update array and read the Goal back. Then
   run
   `vault-cli goal save "Daily nutrition targets" --id <goal-id> --status active`
   and read that same Goal back. When the member changes a proposed value, or a
   missing metric needs a newly derived replacement after an explicit owner
   disappears, send the complete intended post-update `metricTargets` array
   with `status: "paused"` for the same Goal through `goal import-json`,
   explain the revision briefly, and wait for acceptance. If the member
   declines, update the same Goal to `abandoned`. Do not silently recalculate
   accepted values later. If an explicit target appears after activation, send
   the managed Goal's complete retained array without that overlapping metric;
   never edit the explicit Goal.
6. The proposal turn never attaches a card. If an explicit card request caused
   the proposal, its next unambiguous acceptance may be the first later eligible
   response: after activation and readback, reapply
   `daily-nutrition-card-safety.md`, re-read same-date canonical meal totals,
   and attach exactly one card in that acceptance response when the pending
   request is still unambiguous and the card alone completes it. A
   target-setting-only request, correction, decline, ambiguous acceptance, or
   compound request remains ordinary text with no card. Otherwise, only a later
   eligible response with five scalar values resolved from active canonical
   goals may attach the card. On an interactive card request, explain an
   existing paused proposal again unless the member is accepting or changing
   it.

## Evidence register

- [National Academies, 2023 adult EER equations and individual uncertainty](https://www.ncbi.nlm.nih.gov/books/NBK591034/)
- [National Academies adult AMDR and DRI reference tables](https://www.ncbi.nlm.nih.gov/books/NBK208874/)
- [ISSN position stand: protein and exercise](https://link.springer.com/article/10.1186/s12970-017-0177-8)
- [National Academies fiber reference method](https://www.ncbi.nlm.nih.gov/books/NBK208887/)
- [Critical review of athlete weight-gain guidance and its evidence limits](https://pubmed.ncbi.nlm.nih.gov/35233712/)
- [Off-season bodybuilding review: surplus and rate-of-gain context](https://pubmed.ncbi.nlm.nih.gov/31247944/)
- [Meta-analysis: energy deficiency and resistance-training lean-mass gains](https://pubmed.ncbi.nlm.nih.gov/34623696/)
