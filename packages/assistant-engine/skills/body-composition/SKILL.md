---
name: body-composition
description: |
  Plan, review, or troubleshoot intentional fat loss, weight loss, lean-mass gain,
  weight gain, cutting, bulking, recomposition, maintenance, plateaus, and
  body-composition tracking without treating one diet, calorie estimate, BMI,
  scale reading, or consumer body-fat estimate as ground truth.
---

# Body Composition

Use this as Murph operating guidance, not as a consumer article. Ground the answer in the current conversation, vault context, connected measurements, training history, food context, medications, and relevant health constraints before recommending. Ask at most one compact missing question in ordinary cases; ask more only when safety requires it.

This is one owner with several paths. Do not create parallel weight-loss, weight-gain, cut, or bulk plans that can disagree about the same goal, measurements, safety state, or adjustment policy.

## Load Only What the Task Needs

- Read `references/fat-loss.md` for an intentional fat-loss or weight-loss plan, maintenance transition, stalled loss, or regain.
- Read `references/muscle-gain.md` for intentional weight gain, lean-mass gain, bulking, or deciding whether a surplus is useful.
- Read `references/tracking-and-adjustment.md` before creating a measurement plan, interpreting a plateau, changing calories, or reviewing progress.
- Read `references/safety.md` whenever the goal may involve underweight, unintentional change, eating-disorder risk, low energy availability, minors, pregnancy, breastfeeding, major illness, surgery, or medication decisions.
- Read `references/evidence.md` when explaining the basis for a numerical default, comparing approaches, or maintaining this skill.
- Use `nutrition-strategy` for meal structure, grocery or restaurant execution, protein targets and distribution, training fuel, hydration, and food adequacy.
- Use `strength-training` for exercise selection, lifting progression, volume, intensity, and hypertrophy programming.
- Use `behavior-followthrough` when consistency, reminders, friction, shame, lapses, or support style is the main bottleneck.
- Use `food-journal` when the user wants low-burden meal capture or pattern discovery rather than a prescriptive calorie or macro plan.
- Use `experiment-onboarding` only when the user explicitly wants a bounded experiment with a hypothesis and review window.

## Owns

- Clarifying whether the real target is fat loss, muscle gain, intentional weight restoration, recomposition, maintenance, performance, health-risk reduction, or simply understanding a trend.
- Choosing the smallest useful energy-direction decision: deficit, maintenance, maintenance-to-small-surplus, or qualified-care-led restoration.
- Coordinating weight, waist, strength or training performance, food intake, steps or activity, appetite, energy, recovery, and symptoms without making every signal mandatory.
- Setting a review cadence and deciding whether evidence supports holding, adjusting, transitioning to maintenance, or escalating.
- Explaining scale noise, body-composition measurement limits, realistic uncertainty, and why weight change is not identical to fat or muscle change.
- Keeping the plan neutral, private, reversible, and sustainable.

## Hand Off

- Use `nutrition-strategy` for protein targets, distribution, and the concrete food system after this skill chooses the body-composition direction.
- Use `strength-training` for the resistance-training program. This skill may require a training stimulus but should not duplicate programming.
- Use `daily-activity` for a factual activity or step read and `sleep-recovery-readiness` for an acute train-versus-rest decision.
- Use `cardiometabolic-health` when glucose, blood pressure, lipids, or another marker is the primary outcome rather than body composition.
- Use `gut-digestion` when digestive symptoms determine the food plan.
- Route suspected eating disorders, rapid or unexplained weight change, underweight, growth or puberty concerns, pregnancy, post-bariatric care, major organ disease, diabetes-medication risk, prescription weight-loss medication, and surgery decisions to qualified care.
- For postpartum or breastfeeding users, read `references/safety.md`; do not automatically refuse a goal, and involve qualified care when intentional change, lactation, recovery, infant growth, symptoms, or rapid loss makes it material. Murph can still help organize questions, records, measurements, food adequacy, and follow-through around professional care.

## Data First

Use what already exists before asking the user to repeat it. Distinguish measured facts, estimates, and user-reported context.

Check, when relevant:

- goal, reason, urgency, desired outcome, and whether the target is voluntary
- age and life stage; pregnancy, breastfeeding, growth, or older-adult context
- current weight and same-condition trend, not only the latest value
- waist trend or clothing fit if useful and acceptable
- when connected measurements matter, use the lossless global observation read
  `vault-cli measurement entry list --metric <metric> --from <date> --to <date> --limit 50 --format json`
  with `body_mass_index`, `fat`, `lean_body_mass`, or `waist_circumference`.
  Use a short bounded window, take the newest entry for a latest-value question,
  and compare repeated readings for a trend. Keep sources and measurement
  conditions consistent, using the returned source and event ID as provenance;
  imported device observations may be query-only and unavailable through
  `vault-cli show`. No returned entries means missing coverage rather than no
  change
- strength, repetitions, training quality, and resistance-training consistency
- meal or food pattern, estimated protein, alcohol, liquid calories, appetite, and food access
- steps, cardio, sedentary time, sleep, recovery, illness, pain, and recent training changes
- medications, surgery history, medical conditions, menstrual or endocrine changes, and relevant labs
- prior attempts, methods that helped or harmed, tracking tolerance, and eating-disorder or compulsive-exercise risk
- scale, unit, source, timestamp, and whether device values are direct measurements or estimates

Do not request progress photos, exact calorie logging, body-fat percentage, or daily weighing by default. Offer only the minimum measurement burden that can change a decision.

For a daily nutrition-card calorie target, read
`$MURPH_ASSISTANT_SKILLS_ROOT/nutrition-strategy/references/daily-nutrition-card-goals.md`.
This skill owns whether the direction is maintenance/recomp, muscle gain, or fat
loss; the reference owns the researched estimate, conservative adjustment, and
explanation-before-card sequence.

## If Context Is Thin

Ask one high-yield question:

> Are you mainly trying to lose fat, gain muscle or body weight, maintain or recomp, or understand an unexpected trend?

If the answer is “lose weight” or “gain weight,” clarify the intended outcome only when it changes the plan. Do not assume weight loss is medically indicated or that weight gain means a bodybuilding bulk.

## Decide the Lane

1. **Intentional fat loss** — use a sustainable energy deficit plus resistance training when appropriate; include a maintenance plan from the beginning.
2. **Lean-mass gain or bulk** — make progressive resistance training the gate; start at maintenance or a small surplus rather than treating rapid scale gain as success.
3. **Recomposition or maintenance** — use when scale change is unnecessary, preference favors lower burden, or the user can plausibly improve strength and waist or body composition without a large energy change.
4. **Qualified-care-supported restoration** — use for underweight, malnutrition risk, significant unintentional loss, eating-disorder recovery, post-surgical needs, or illness-driven weight loss. Do not turn this into a self-directed bulk.
5. **Understand the trend** — investigate measurement conditions, fluid and glycogen shifts, medications, illness, intake, activity, and time window before creating a goal.
6. **Short-term scale manipulation** — do not help with dehydration, purging, laxatives, diuretics, starvation, or an aggressive competition cut. Route to safer performance and clinician support.

## Build the Smallest Complete Plan

A complete plan can be short, but it must include:

1. **Outcome and reason** — what change matters and why.
2. **Baseline** — enough same-condition data to distinguish trend from noise.
3. **Primary lever** — one repeatable food, energy, or environment change; not a pile of rules.
4. **Muscle-preservation or gain signal** — resistance training and adequate protein when appropriate.
5. **Minimum tracking** — one primary outcome plus one or two context signals.
6. **Review window** — long enough to observe a trend and short enough to correct course.
7. **Adjustment rule** — what evidence would cause hold, small change, pause, maintenance, or escalation.
8. **Exit or maintenance phase** — what happens after the initial target or if costs exceed benefits.

Planning is not activation. Do not create goals, recurring check-ins, calorie targets, automations, experiments, tables, or reminders until the user clearly asks Murph to do so. After activation, use canonical vault and CLI surfaces; do not maintain a second body-composition record inside the conversation.

## Interpretation Rules

- Weight is a mixed signal: fat, lean tissue, glycogen, water, gastrointestinal contents, and measurement error all contribute.
- Compare rolling or weekly summaries under similar conditions. One reading should almost never trigger an energy adjustment.
- Water, sodium, carbohydrate intake, alcohol, travel, illness, constipation, menstrual-cycle phase, creatine, and new or hard training can obscure the underlying direction for days or weeks.
- BMI can be useful population or screening context but is not a direct body-fat measure, a diagnosis, or a moral score.
- Consumer BIA body-fat and lean-mass estimates are not interchangeable with criterion methods at the individual level. Treat them as noisy estimates, keep device and conditions consistent, and do not derive precise tissue changes from small movements.
- Waist down with maintained or improved strength can be meaningful fat-loss progress even when weight is flat.
- Weight up with better performance is not proof of muscle gain; check time, waist, training progression, and the size of the surplus.
- Calorie expenditure and intake calculations are starting hypotheses. Calibrate from observed trend and context rather than claiming exact energy balance.
- Recomposition is possible but slow and variable. Do not promise it or use an unchanged scale to prove it.

## Adjustment Discipline

- Hold when the data window is too short, measurements are inconsistent, a major confounder is active, or the current plan is working.
- Change one primary lever at a time unless safety requires stopping.
- Prefer a small reversible adjustment over a large correction.
- Never reduce intake or increase exercise automatically from one weigh-in, one body-fat estimate, one missed target, or an incomplete food log.
- When repeated data and adherence disagree, investigate measurement, hidden friction, food-access reality, activity adaptation, and reporting uncertainty without accusing the user.
- Pause or move toward maintenance when recovery, performance, mood, menstrual function, food preoccupation, or physical symptoms meaningfully worsen.
- Celebrate process and capability without praising thinness, rapid gain, restriction, or a particular body shape.

## Safety Boundaries

Read `references/safety.md` before giving a plan when risk is plausible.

Do not recommend:

- purging, vomiting, laxatives, diuretics, dehydration, sweat suits, or deliberate fluid restriction for scale change
- starvation, unsupervised very-low-calorie diets, prolonged fasting as a default fat-loss method, or “earning” food with exercise
- aggressive competition weight cuts, rapid catch-up bulks, “dirty bulks,” or compensatory exercise after eating
- changing prescription medications, GLP-1 or other anti-obesity drugs, insulin, or post-bariatric supplementation without the treating team
- a tracking method that is worsening obsession, fear, shame, bingeing, restriction, or compulsive exercise

Escalate urgent symptoms such as fainting, confusion, chest pain, severe weakness, repeated vomiting, signs of dehydration, or suicidal or self-harm risk through the appropriate urgent-care pathway.

## Product Actions and Privacy

- Keep body measurements, food logs, photos, and goals private unless the user explicitly shares them.
- Do not ask for photos when weight, waist, clothing fit, performance, or symptoms can answer the question.
- Explain what Murph will record before enabling a recurring check-in.
- Store direct measurements with source, unit, and timestamp. Keep estimates labeled as estimates.
- Preserve raw device provenance and avoid duplicate manual writes when a connected scale already supplies the same measurement.
- If the user asks for a table or visual tracker, use `tracked-table`; the canonical measurements and goal remain the source of truth.

## Answer Shape

- State the lane and the decision that matters now.
- Name the evidence already available and the largest uncertainty.
- Give one primary action, one measurement plan, and the review timing.
- Include the hold or adjustment rule and the maintenance or exit path.
- Surface a safety boundary only when relevant; do not bury the useful answer in generic disclaimers.
- Keep estimates and heuristics labeled. Be direct about where evidence is weak.
