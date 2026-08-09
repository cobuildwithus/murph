# Daily nutrition-card goals

Use this only when Murph is otherwise eligible to send a private daily
nutrition card and the member does not already have one complete, unambiguous
daily target for calories, protein, carbohydrate, fat, and fiber.

## Safety and authority

- Do not derive, save, or surface numeric goals for intuitive-eating or
  number-sensitive contexts; known or suspected eating disorder, severe
  restriction, purging, compulsive exercise, rapid or unexplained weight
  change, under-fueling or RED-S concern; anyone under 18; pregnancy or
  breastfeeding; glucose-lowering medication; kidney disease, advanced liver
  disease, significant heart disease, relevant endocrine disease,
  post-bariatric care, a therapeutic diet, or another clinician-managed
  nutrition context. Keep the owning skill's non-numeric or clinical path.
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
- If one consolidated question can collect the genuinely missing inputs, ask it
  once. Until a responsible calorie estimate and all five goals exist, save no
  active defaults and attach no card.

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

   Reuse the same Goal id and stable target ids on every update. Read it back;
   never create a duplicate or rewrite an unchanged proposal.
4. A turn that creates or changes the paused proposal must be ordinary text,
   never a card. Briefly name all five effective values, which facts and labeled
   assumptions materially drove them, and why calories, protein, carbohydrate,
   fat, and fiber landed there. Call them provisional and invite correction or
   acceptance. This explanation must happen before the first goal-aware card.
5. When the member accepts the proposal, run
   `vault-cli goal save "Daily nutrition targets" --id <goal-id> --status active`
   and read that same Goal back. First re-read target authority and remove from
   the managed proposal any metric that has gained an explicit owner. When the
   member changes a proposed value, update that target in the same paused Goal
   through `goal import-json`, explain the revision briefly, and wait for
   acceptance. If the member declines, update the same Goal to `abandoned`. Do
   not silently recalculate accepted values later. If an explicit target appears
   after activation, remove only that overlapping metric from the managed Goal;
   never edit the explicit Goal.
6. Only a later eligible response with five scalar values resolved from active
   canonical goals may attach the card. Re-read meal totals immediately before
   attachment. On an interactive card request, explain an existing paused
   proposal again unless the member is accepting or changing it. Do not repeat
   an automatic setup pitch on every scheduled closeout.

## Evidence register

- [National Academies, 2023 adult EER equations and individual uncertainty](https://www.ncbi.nlm.nih.gov/books/NBK591034/)
- [National Academies adult AMDR and DRI reference tables](https://www.ncbi.nlm.nih.gov/books/NBK208874/)
- [ISSN position stand: protein and exercise](https://link.springer.com/article/10.1186/s12970-017-0177-8)
- [National Academies fiber reference method](https://www.ncbi.nlm.nih.gov/books/NBK208887/)
- [Critical review of athlete weight-gain guidance and its evidence limits](https://pubmed.ncbi.nlm.nih.gov/35233712/)
- [Off-season bodybuilding review: surplus and rate-of-gain context](https://pubmed.ncbi.nlm.nih.gov/31247944/)
- [Meta-analysis: energy deficiency and resistance-training lean-mass gains](https://pubmed.ncbi.nlm.nih.gov/34623696/)
