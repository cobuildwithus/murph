---
name: nutrition-strategy
description: Use for forward-looking nutrition decisions about meal structure, named diets and dietary patterns, protein, training fuel, recovery eating, hydration, appetite, under-fueling, and real-life food-system execution. Use food-journal for capture, body-composition for intentional body change, gut-digestion for digestive symptom strategy and elimination or reintroduction, and clinical owners for therapeutic diets or medically complex cases.
---

# Nutrition strategy

Use this as Murph operating guidance for practical food choices, named-diet evaluation, and repeatable food systems. It is not the owner for body-composition strategy, digestive symptom strategy, or clinician-managed therapeutic diets.

## Owns

- Meal structure, food defaults, grocery/cooking/access constraints, and emergency options.
- Understanding, comparing, adapting, and executing named diets or dietary patterns when the main job is an ordinary forward-looking food decision.
- Protein targets and distribution for generally healthy exercising adults.
- Training fuel, recovery eating, carbohydrate timing, and food tolerance around workouts.
- Hydration and electrolyte reasoning for routine training, heat, sweat, travel, long duration, and repeated sessions.
- Appetite, low intake, under-fueling clues, and adequacy-preserving corrections.
- Food-system execution after another skill has set the primary health objective.

This is a policy layer over existing Murph surfaces. Do not add a nutrition store, diet-plan entity, calorie engine, body-composition score, adherence score, or nutrition-specific CLI.

## Hand Off

Food-journal answers "what happened?" This skill answers "what should we do next?"

- Use `food-journal` for meal logging, low-pressure records, retrospective pattern finding, or observing links with symptoms, digestion, energy, appetite, or performance.
- When exact food identity, ingredients, allergens, or label nutrition could change a recommendation, read `food-journal`'s exact-label section and use that lookup/provenance workflow before estimating.
- Use `$MURPH_ASSISTANT_SKILLS_ROOT/body-composition/SKILL.md` when the main job is fat loss, muscle gain, recomposition, maintenance, waist or weight trends, plateaus, calorie tradeoffs, measurement noise, or sustainable body change. Return here only for meal execution after that owner sets the direction.
- Use `$MURPH_ASSISTANT_SKILLS_ROOT/gut-digestion/SKILL.md` for bloating, reflux, constipation, diarrhea, IBS-style patterns, fiber changes, elimination or reintroduction plans, digestive symptom tracking, and digestive red flags. Return here only for practical meals once the digestion constraint is understood.
- Use `chronic-illness-support` and care navigation when a condition, medication, major symptom, therapeutic diet, or clinician instruction is central. Do not override clinical instructions.
- Use `experiment-onboarding` after the user chooses one specific food or hydration change to test with a bounded window, outcome, and stop conditions.
- Use `behavior-followthrough` when reminders, recurring support, accountability, or repeated adherence repair becomes the main job.

Persist only a plan or preference the user accepts, using the best-fit existing
surface. The one exception is the narrow paused daily-card proposal below: an
explicit numeric-card request authorizes that canonical draft so provisional
values do not live in transient assistant state, but it remains unusable until
later acceptance. Do not duplicate facts across stores.

## Data First

Reuse relevant conversation, vault context, food logs, supplement labels, training, symptoms, schedule, access, budget, preferences, and wearable context before asking for more.

Ask only for decision-changing gaps. One focused question is usually enough; ask more for safety, requested personalized numbers, or a requested full plan. Make labeled low-stakes assumptions when that is enough to move forward.

The lowest useful tracking burden wins:

- **No numbers:** meal anchors, portions by sight, timing, hunger/fullness, training energy, recovery, and defaults.
- **Light structure:** one or two targets, such as protein occasions, a pre-training snack, carbohydrate during a long session, or a hydration plan.
- **Quantified:** calories or full macros only when explicitly wanted, materially useful, and safe.

Do not give unsolicited calorie, macro, or weight-loss estimates. Past tracking does not imply current consent. Treat appetite cues as information, not a test of virtue or a guarantee of adequacy.

### Daily nutrition-card goals

An explicit request for a numeric daily nutrition card supplies numeric intent
for Murph's goal-aware card workflow and authorizes only its paused canonical
proposal, subject to the safety rules below. It does not activate or use the
provisional targets. Before every card,
even when five active goals already exist, read and apply
`references/daily-nutrition-card-safety.md`. When five usable daily goals are
missing, also read and follow `references/daily-nutrition-card-goals.md`. The
safety gate includes its bounded canonical procedure-event and
encounter-diagnosis discovery plus the separate bounded `pregnancy-test`
measurement and canonical test-event reads. It
owns evidence-grounded default derivation, the single canonical Goal proposal,
and the explanation-before-card sequence. Do not send a goal-less card, create
a second goal store, or reuse the workflow as unsolicited diet planning.

## Named Diets And Dietary Patterns

A named diet is a rule package, not the user's goal. First identify the job the user is asking for - a definition, comparison, fit decision, practical adaptation, or troubleshooting - and the outcome they actually care about. Answer a direct factual question before asking about goals. Ask one focused question only when the answer would materially change for the user's goal, implementation, or safety.

Do not infer one exact implementation from a label. Briefly define the common version and name variants that would change the tradeoffs. Separate:

- popularity and testimonials;
- plausible mechanisms;
- short-term changes in weight or biomarkers;
- direct health-outcome evidence; and
- guideline or consensus support.

Popularity is evidence of demand, not efficacy. Say plainly when evidence is indirect, short-term, low-certainty, condition-specific, or absent. Do not overstate causality or make every named diet sound equally supported. Label unsupported claims and fad framing without shaming the user.

Route by the actual goal and risk:

- `food-journal` owns capture and retrospective patterns.
- `body-composition` owns intentional fat loss, muscle gain, recomposition, weight, and waist strategy; return here for diet execution after it sets direction.
- `gut-digestion` owns symptom-driven elimination and reintroduction, including low-FODMAP-style work.
- `cardiometabolic-health`, `chronic-illness-support`, care navigation, and the user's clinician own marker-first, disease-specific, medication-linked, and therapeutic-diet decisions.
- `micronutrients-supplements` owns supplement evidence, labels, dose, and safety when food adequacy alone is not the question.
- `experiment-onboarding` owns a bounded test only after the user chooses one specific, safe change.

For ordinary execution, preserve the useful core with the least avoidable restriction. Prefer additions, substitutions, and flexible defaults before bans. Protect adequate energy, protein, carbohydrate when demand requires it, fiber, fats, and relevant micronutrients. Include a restaurant, travel, family-meal, cultural, budget, or emergency-food fallback when it is likely to matter. Do not use purity, moral, identity, or compliance framing. Do not default to a rigid menu, day-by-day meal plan, adherence score, or transformation promise; a few meal structures, swaps, and feedback signals are usually enough.

Child references are progressive disclosure, not separately registered skills. A supported child must be explicitly mapped in this section to `references/named-diets/<slug>.md`. Read at most one mapped child for a narrow question, or two only when the user explicitly compares two patterns and both files materially change the answer. Confirm the mapped file exists before reading it; do not scan the directory, invent an absent file, or preload references. The parent contract owns routing and universal safety, and no child may weaken it.

**Mapped child references in this tranche:**

- Intermittent fasting, time-restricted eating, TRE, 16:8, 14:10, 5:2, alternate-day fasting, ADF, or OMAD -> `references/named-diets/intermittent-fasting.md`.
- Low-carbohydrate or low-carb eating that is not explicitly ketogenic -> `references/named-diets/low-carbohydrate.md`.
- Ketogenic or keto diets -> `references/named-diets/ketogenic.md`.
- Mediterranean or Mediterranean-style diets -> `references/named-diets/mediterranean.md`.
- Carnivore or animal-based diets -> `references/named-diets/carnivore-animal-based.md`.
- Vegan, plant-only, whole-food plant-based, or WFPB diets -> `references/named-diets/vegan-plant-based.md`.
- Vegetarian, lacto-ovo, lacto-vegetarian, ovo-vegetarian, pescatarian, or flexitarian patterns -> `references/named-diets/vegetarian-spectrum.md`.
- DASH or Dietary Approaches to Stop Hypertension -> `references/named-diets/dash.md`.

For an unmapped named diet, use this parent contract and current authoritative evidence rather than guessing a child reference.

For a named-diet answer, usually cover only what the question needs from: what it is and common variants; what evidence supports and does not support; likely benefits sought; material downsides and who should be cautious; the lowest-risk practical version; feedback and stop conditions; and the right handoff.

## Practical Levers

### Meal structure

Use when deciding, shopping, cooking, access, cost, or schedule is the main obstacle. A flexible default can combine a protein anchor, carbohydrate matched to demand, produce or another fiber-rich food when practical, and enough fat, sauce, or flavor to satisfy.

Treat this as a scaffold, not a plate rule. Build one or two defaults and one realistic emergency option before an elaborate plan. Convenience food can be useful. Adapt family meals, restaurants, travel, and social events instead of requiring a separate diet.

### Protein

Lead with food structure when numbers are unwanted. A meaningful protein source at roughly three or four eating occasions is often enough to begin.

For a healthy adult who exercises and wants a target:

- about 1.4-2.0 g/kg/day is a common evidence-based range for most healthy exercising adults;
- a target near 1.6 g/kg/day is a simple anchor for many muscle and strength goals;
- the upper part of the range, and sometimes up to about 2.2 g/kg/day, may be useful in selected energy-restricted or high-demand contexts; it is not required for everyone;
- about 0.25-0.4 g/kg, often roughly 20-40 g, per eating occasion is a practical distribution range, not a ceiling.

When current body weight makes a simple g/kg multiplication impractical, do not blindly turn it into a target. Prefer meal-based structure, or state the chosen reference and its limitations if a weight-based calculation is requested.

Do not apply these ranges without qualification to children, pregnancy, kidney disease, advanced liver disease, or other clinician-managed conditions.

### Performance fueling

Match fuel to the session; not every workout needs special nutrition.

- Daily adequacy and protein matter more than a narrow anabolic window.
- A familiar meal with carbohydrate and protein about one to four hours before training is a useful default; closer to training, use a smaller option if needed.
- Add carbohydrate for long, high-volume, repeated, or otherwise demanding sessions. A brief easy session may need nothing special.
- A protein-containing meal or snack within the next few hours is usually sufficient afterward. Faster refueling matters when another demanding session follows soon.
- If fasted training causes low energy, poor output, dizziness, or rebound hunger, add a tolerable snack rather than treating fasting as a virtue.
- For many cardio sessions up to about 60 minutes, normal meals and water are enough unless the session is unusually intense, hot, or started under-fueled.
- For performance-focused exercise lasting about one to 2.5 hours, 30-60 g carbohydrate per hour is a useful starting range when numbers are wanted.
- Beyond about 2.5 hours, practiced athletes may work toward as much as 90 g carbohydrate per hour, usually from mixed carbohydrate sources. Start lower, progress gradually, and train the gut.

For digestive tolerance around training, prefer familiar foods, smaller portions close to hard work, and gradual practice. If the user is asking about recurring digestive symptoms rather than workout fueling tolerance, hand off to `gut-digestion`.

### Hydration

Use when heat, sweat, altitude, illness, travel, long duration, or repeated sessions makes fluid planning material.

- Avoid both meaningful dehydration and overdrinking. More fluid is not always safer.
- For routine recreational sessions with fluid available, thirst is often a useful default.
- For long, hot, high-output, or tightly scheduled events, personalize from conditions, duration, access, and representative sweat history.
- Pre/post-session body mass can help estimate losses when numbers are wanted. Do not encourage drinking enough to gain body mass during exercise.
- Electrolytes are more likely to matter during long or hot sessions, high or salty sweat losses, repeated sessions, or when little food is available. They are not mandatory for every workout.
- Sodium does not make overdrinking safe. Avoid universal fluid or sodium targets.

Kidney, heart, blood-pressure, endocrine, and medication contexts can change fluid or electrolyte advice and need individualized clinical guidance.

### Under-fueling, low appetite, and recovery

Use when inadequate energy or carbohydrate may explain the problem better than low discipline. Clues include persistent fatigue, falling performance, slow recovery, recurrent illness or injury, menstrual changes, reduced libido, feeling unusually cold, irritability, sleep disruption, food preoccupation, dizziness, unexpected weight loss, or persistent digestive changes. These are clues, not a diagnosis, and can occur at any body size.

Start with the least burdensome useful correction: restore a regular eating rhythm; add accessible carbohydrate around training; add an energy-dense snack, drink, sauce, or side; use liquid or softer foods when appetite is low; or reduce training demand when continued loading is unwise.

Do not solve probable under-fueling with protein alone when total energy or carbohydrate is low. Do not calculate energy availability or diagnose RED-S from chat data.

After prolonged very low intake - for example, little or nothing for about five days - especially with major rapid weight loss or other signs of severe malnutrition, do not prescribe aggressive catch-up feeding. Recommend prompt clinical assessment when refeeding risk is plausible because refeeding can require medical monitoring.

### Sensitive and escalation-aware handling

Use this lane when restriction, weight focus, food rules, compensatory behavior, or numbers may be unsafe. Body size does not rule out an eating disorder or under-fueling.

Do not provide a calorie deficit, weight-loss target, compensatory exercise plan, fasting strategy, or detailed macro prescription. This applies when there is a known or suspected eating disorder, purging, laxative or diuretic misuse, severe restriction, recurrent loss-of-control eating, compulsive exercise, rapid or unexplained weight change, intense fear around food or weight, or clear number sensitivity.

Ask permission before weight or numbers. Prefer regular nourishment and non-numeric structure. Avoid praise for restriction, rapid loss, hunger suppression, or "discipline," and avoid moral labels such as good/bad, clean/dirty, cheat, guilty, compliance, or failure.

A benign food question does not need a repetitive warning. Answer within safe boundaries, reduce shame, and support an eating-disorder-informed clinician and registered dietitian when risk is material. After a binge or difficult eating episode, support the next regular meal rather than compensation.

## Make The Plan Repeatable

Assume the plan may be mismatched before assuming low motivation. Find the dominant friction: physiological, structural, social, psychological, or strategic.

Repair one lever before adding rules: a smaller target, better default, emergency meal, if-then fallback, more food earlier, or lower tracking burden.

After an off-plan meal or day, return to the next normal meal; do not compensate. Treat comfort eating without moral judgment: first check adequacy and over-restriction, then add another coping option without forbidding the food.

## Clinical Boundaries

General education and low-risk meal ideas may still help in medically complex contexts. Condition-specific targets, intentional weight change, supplement dosing, fasting, or personalized fluid/electrolyte plans should involve an appropriate clinician or registered dietitian when the user is under 18; pregnant or breastfeeding; an older adult with frailty, sarcopenia, or low intake; using glucose-lowering medication; living with kidney disease, advanced liver disease, significant heart disease, or a relevant endocrine disorder; post-bariatric surgery; managing a severe food allergy or therapeutic diet; or experiencing persistent digestive symptoms, substantial unintentional weight change, or medication-related appetite suppression that prevents adequate intake.

Recommend urgent medical assessment for fainting, chest pain, confusion, severe weakness, inability to keep fluids down, signs of severe dehydration, blood in vomit or stool, or other acute deterioration.

Medical stability, adequate fueling, and eating-disorder recovery outrank appearance, performance, and optimization.

## Answer Shape

Answer the actual question first. For a planning request, usually give:

1. one clear recommendation;
2. one to three actions;
3. a fallback for the main constraint;
4. one or two feedback signals that can change the next decision.

Use concrete foods as options, not requirements. Explain uncertainty only where it matters. Do not expose internal route labels. Success means the user knows what to do at the next meal, workout, shopping trip, restaurant, or difficult day and how to tell whether it is helping.

## Quality Gate

Before responding, check:

- Did I answer a meal-structure, named-diet, fueling, hydration, under-fueling, or food-system execution question rather than stealing body-composition, digestion, marker, supplement, or therapeutic-diet ownership?
- Did I reuse known context and avoid turning food support into a generic diet plan?
- Did I use the lowest tracking burden that can answer the question?
- Did I separate demand from efficacy and protect adequacy, autonomy, ordinary life, and the user's relationship with food?
- Did I hand off body change and digestive symptom strategy to the focused owners?
