# Tracking and Adjustment

Last reviewed: **2026-08-09**

This file defines the minimum evidence Murph should gather before calling progress, a plateau, or an adjustment. It applies to fat loss, muscle gain, recomposition, maintenance, and unexplained weight trends.

## Principles

1. **Track only what can change a decision.**
2. **Preserve canonical measurements and provenance.**
3. **Separate direct measurements from estimates and interpretations.**
4. **Use trends, not verdicts from single readings.** One reading should almost never trigger a plan adjustment.
5. **Change one main lever at a time.**
6. **Never auto-adjust intake or exercise without enough evidence and user consent.**
7. **Reduce tracking when its psychological or practical cost exceeds its value.**

## Minimum Useful Tracking Sets

Choose one primary outcome and one or two context signals.

### Fat loss

- primary: same-condition weight trend or waist trend
- context: strength or training quality
- context: appetite, energy, adherence, or steps

### Lean-mass gain

- primary: training performance or a target circumference
- context: same-condition weight trend
- context: waist, appetite, digestion, or recovery

### Recomposition

- primary: waist or another chosen circumference
- context: strength or repetitions
- context: weight trend

### Maintenance

- primary: broad weight or waist range, checked at a tolerable cadence
- context: one behavior or capability the user values
- context: symptoms or health marker when relevant

### Understand an unexpected trend

- primary: verified weight measurements with source and timestamps
- context: medications, illness, fluid, food, activity, bowel, cycle, and training changes
- context: symptoms and whether the change was intentional

Do not require all of these. A user who does not want to weigh can use waist, clothing fit, performance, mobility, or a clinician-agreed marker.

## Measurement Protocols

### Weight

Prefer:

- the same scale
- after waking and bathroom use when practical
- before food and large drinks
- similar clothing or no clothing
- a consistent surface and scale placement
- direct connected-scale data when available, without duplicate manual entries
- units preserved as recorded; aggregate only same-unit values until an explicit shared conversion contract exists

Cadence is a preference and safety choice:

- daily values can improve the trend estimate for users comfortable with them
- several readings per week are often sufficient
- weekly may be the highest tolerable cadence
- no weighing is valid when it is distressing or unsafe

Use one declared seven-day summary method, mean or median, when sampling is frequent, and keep that method stable across compared windows. Do not silently switch methods to improve the story. For sparse data, state the limitation rather than manufacturing a precise slope.

### Waist and other circumferences

Keep site, posture, breathing phase, tape tension, time of day, and measurer consistent. Weekly or less often is usually enough. Do not infer visceral fat or exact fat mass from a small tape change.

### Training performance

Prefer repeated exercises or movement patterns with comparable technique, range of motion, equipment, and effort. A personal record can reflect skill, leverage, motivation, or fatigue as well as muscle. Use several sessions.

### Photos

Photos are optional and private. Never ask by default, never require revealing clothing, and never share to a group without explicit per-item consent. Lighting, pose, distance, pump, and camera processing can dominate small changes.

### Consumer body-composition devices

Label BIA body-fat, lean-mass, muscle-mass, and visceral-fat outputs as estimates. At the individual level, absolute values can differ substantially from criterion methods. Hydration, food, glycogen, skin temperature, recent exercise, and device equations can move the result.

- keep device and conditions consistent
- use coarse long-term direction only when it agrees with other signals
- do not merge estimates from different devices into one seamless trend
- do not claim a precise amount of fat lost or muscle gained
- do not let a BIA change override weight, waist, performance, symptoms, or clinical imaging
- preserve the vendor metric name and source rather than rewriting it as measured tissue

### BMI

BMI is derived context, not a body-composition measurement. Do not store it as though it were directly measured, use it alone to prescribe loss or gain, or present a category as a personal judgment.

## Trend Read

For every progress review, report:

- measurement window and number of observations
- source or device when relevant
- whether current-day data are provisional
- summary method
- start and end summaries, not only endpoints
- important confounders
- one primary interpretation with uncertainty
- whether the current evidence supports hold, adjust, pause, or escalate

Avoid presenting a linear regression slope when the sample is sparse or the pattern is visibly nonlinear. A simple comparison of adjacent weekly summaries is often more honest.

## Plateau Criteria

Do not call a plateau until:

- the window is long enough for the goal and expected rate
- measurements are comparable
- at least one primary and one context signal are available when practical
- transient confounders have been considered
- the plan was executable enough to evaluate
- the apparent lack of change would actually alter the next decision

Two to four weeks is a common minimum for weight or waist decisions. Use longer windows for trained muscle gain, cycle-related fluid shifts, illness, travel, creatine initiation, or sparse measurements.

A stable scale can still be progress when waist falls or strength rises. A rising scale can still be a problem when waist rises rapidly without performance or recovery benefit.

## Adjustment Contract

An adjustment must specify:

- evidence window
- current trend and uncertainty
- confounders checked
- one lever changing
- expected direction, not a guaranteed number
- next review date or data threshold
- stop or rollback condition
- user consent when Murph will update a goal, target, automation, or recurring check-in

Good adjustment:

> Across three comparable weekly summaries, weight and waist are flat, training is stable, and the planned restaurant change happened most weeks. Reduce the one recurring evening snack portion or add a short walk after lunch—not both—then review after two more weeks.

Bad adjustment:

> Yesterday’s weight was up 1.2 lb, so I cut 300 calories.

Never turn an incomplete food log into a claim that the user ate a specific surplus or deficit.

## Canonical Data and Current CLI Audit

Current primitives already cover the durable facts:

- `murph measurement add` records open scalar metrics such as body weight or waist with value, unit, timestamp, source, qualifiers, and notes.
- `murph measurement list` reads measurement events by date range.
- `murph goal save` stores goal identity, status, horizon, priority, dates, domains, and relations.
- food, meal, exercise or workout, experiment, journal, wearable, and device commands provide surrounding context.

Use those surfaces when available. Do not create a second JSON or Markdown “weight tracker” as canonical truth.

Current limitations are documented in `docs/body-composition-cli-audit.md`. Until generic metric-filtered trend reads exist:

- inspect canonical measurements rather than relying on conversation memory
- state when the read is incomplete
- do not hand-calculate and persist a derived trend as a new direct measurement
- do not invent a body-composition command
- keep proposed calorie or rate targets in the response unless the user explicitly asks to activate a supported goal or experiment

## Suggested Check-In Shape

A low-burden check-in can ask:

1. What changed in the primary trend?
2. How did training or capability change?
3. How were appetite, energy, recovery, and symptoms?
4. Was the chosen behavior repeatable?
5. Was there a major confounder?
6. Hold, small adjustment, maintenance, pause, or clinician follow-up?

Ask fewer questions when existing data answer them.

## Privacy and Sharing

- Default all body-composition data to private.
- Do not include weight, waist, calories, photos, eating-disorder history, medication use, or body commentary in a group summary without explicit consent.
- Do not rank people by weight lost, calories eaten, thinness, or body-fat percentage.
- In a group challenge, prefer participant-chosen behaviors or capabilities and use `group-challenge` consent rules.
