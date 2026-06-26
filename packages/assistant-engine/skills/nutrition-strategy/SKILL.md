---
name: nutrition-strategy
description: Use for forward-looking nutrition decisions about meal structure, protein, body composition, training fuel, hydration, appetite, under-fueling, recovery, GI comfort, and real-life constraints. Use food-journal for meal capture or retrospective pattern finding.
---

# Nutrition strategy

## Outcome and scope

Help the user choose the smallest useful nutrition change that supports their health, training, or body-composition goal and fits their life. Protect adequacy, performance, autonomy, and their relationship with food. Build repeatable food systems, not a diet catalog.

This is a policy layer over existing Murph surfaces. Do not add a nutrition store, diet-plan entity, calorie engine, body-composition score, adherence score, or nutrition-specific CLI.

## Ownership and handoffs

Food-journal answers "what happened?" This skill answers "what should we do next?"

- Use `food-journal` for meal logging, low-pressure records, retrospective pattern finding, or observing links with symptoms, digestion, energy, appetite, or performance.
- Use this skill for recommendations, targets, meal structure, fueling, hydration, body composition, or adaptation to real-life constraints.
- When the user explicitly wants both, capture through `food-journal`, then answer the forward-looking question here. Do not turn every log into coaching.
- Use `experiment-onboarding` after the user chooses one specific change to test with a bounded window, outcome, and stop conditions. Ordinary coaching does not need to become an experiment.
- Use `behavior-followthrough` when reminders, recurring support, accountability, or repeated adherence repair becomes the main job. This skill owns nutrition rationale; `behavior-followthrough` owns the support loop.
- Use `chronic-illness-support` and care navigation when a condition, medication, major symptom, or clinician-directed diet is the central constraint. Do not override clinical instructions.

Persist only a plan or preference the user accepts, using the best-fit existing surface. Do not duplicate facts across stores.

## Working policy

1. Identify the lead objective and the constraint most likely to determine success.
2. Let safety, under-fueling, or eating-disorder sensitivity override optimization.
3. Choose one internal coaching lane and include only modifiers that change the plan.
4. Use the lowest tracking burden that can answer the question.
5. Give the next useful action, not a nutrition course.

The coaching lanes below are internal routing aids. Do not announce a mode label or present the catalog unless it genuinely helps the user.

Reuse relevant context. Make a labeled, low-stakes assumption when that is enough to move forward. Ask only for decision-changing gaps. One focused question is usually enough; ask more for safety, requested personalized numbers, or a requested full plan.

## Coaching lanes

### General healthy eating

Use when health, energy, enjoyment, or food quality matters more than a precise target. Prioritize enough food, a useful protein source, carbohydrate suited to activity, varied fiber-rich foods when tolerated, satisfying fats and flavor, and room for culture and enjoyment. Improve the weakest useful link rather than every meal at once.

### Low-friction meal structure

Use when deciding, shopping, cooking, access, cost, or schedule is the main obstacle. A flexible default can combine a protein anchor, carbohydrate matched to demand, produce or another fiber-rich food when practical, and enough fat, sauce, or flavor to satisfy.

Treat this as a scaffold, not a plate rule. Build one or two defaults and one realistic emergency option before an elaborate plan. Convenience food can be useful. Adapt family meals, restaurants, travel, and social events instead of requiring a separate diet.

### Performance fueling

Match fuel to the session; not every workout needs special nutrition.

For strength or power:

- Daily adequacy and protein matter more than a narrow anabolic window.
- A familiar meal with carbohydrate and protein about one to four hours before training is a useful default; closer to training, use a smaller option if needed.
- Add carbohydrate for long, high-volume, repeated, or otherwise demanding sessions. A brief easy session may need nothing special.
- A protein-containing meal or snack within the next few hours is usually sufficient afterward. Faster refueling matters when another demanding session follows soon.
- If fasted training causes low energy, poor output, dizziness, or rebound hunger, add a tolerable snack rather than treating fasting as a virtue.

For cardio or endurance:

- For many sessions up to about 60 minutes, normal meals and water are enough unless the session is unusually intense, hot, or started under-fueled.
- For performance-focused exercise lasting about one to 2.5 hours, 30-60 g carbohydrate per hour is a useful starting range when numbers are wanted.
- Beyond about 2.5 hours, practiced athletes may work toward as much as 90 g carbohydrate per hour, usually from mixed carbohydrate sources. Start lower, progress gradually, and train the gut.
- Practice foods, fluids, concentration, and timing before an important event. With a short recovery window, replace carbohydrate, protein, and fluid promptly; otherwise the next balanced meal is often enough.

### Body composition

Use for muscle gain, fat loss, recomposition, or maintenance. Maintenance is legitimate.

- Energy balance influences weight direction, but calorie estimates are not measurements and the plan is more than arithmetic.
- Choose the least restrictive approach likely to create the needed direction.
- For fat loss, protect protein, resistance training, sleep, recovery, food satisfaction, and training fuel. Persistent hunger, declining performance, food preoccupation, or poor recovery suggests the plan is too aggressive.
- For muscle gain, pair progressive resistance training with adequate protein and energy. Add a small surplus only when useful; faster scale gain is not automatically more muscle.
- For recomposition, prioritize progressive training, protein, and stable intake. Visible change may be slow, especially for experienced lifters.
- When quantified planning is appropriate, treat estimated maintenance as a starting hypothesis, make a modest change, hold the plan long enough to read a trend, and adjust one lever at a time.
- Use the least burdensome feedback that informs a decision. Do not react to one weigh-in, infer body-fat percentage from appearance, or promise a precise timeline.

Do not route by named diet. Fit the approach to health needs, training, appetite, preferences, culture, access, budget, and likely adherence.

### Hydration

Use when heat, sweat, altitude, illness, travel, long duration, or repeated sessions makes fluid planning material.

- Avoid both meaningful dehydration and overdrinking. More fluid is not always safer.
- For routine recreational sessions with fluid available, thirst is often a useful default. For long, hot, high-output, or tightly scheduled events, personalize from conditions, duration, access, and representative sweat history.
- When numbers are wanted, pre/post-session body mass can help estimate losses. Do not encourage drinking enough to gain body mass during exercise.
- Electrolytes are more likely to matter during long or hot sessions, high or salty sweat losses, repeated sessions, or when little food is available. They are not mandatory for every workout.
- Sodium does not make overdrinking safe. Avoid universal fluid or sodium targets.

Kidney, heart, blood-pressure, endocrine, and medication contexts can change fluid or electrolyte advice and need individualized clinical guidance.

### Under-fueling, low appetite, and recovery

Use when inadequate energy or carbohydrate may explain the problem better than low discipline. Clues include persistent fatigue, falling performance, slow recovery, recurrent illness or injury, menstrual changes, reduced libido, feeling unusually cold, irritability, sleep disruption, food preoccupation, dizziness, unexpected weight loss, or persistent GI changes. These are clues, not a diagnosis, and can occur at any body size.

Start with the least burdensome useful correction: restore a regular eating rhythm; add accessible carbohydrate around training; add an energy-dense snack, drink, sauce, or side; use liquid or softer foods when appetite is low; or reduce training demand when continued loading is unwise.

Do not solve probable under-fueling with protein alone when total energy or carbohydrate is low. Do not calculate energy availability or diagnose RED-S from chat data.

After prolonged very low intake - for example, little or nothing for about five days - especially with major rapid weight loss or other signs of severe malnutrition, do not prescribe aggressive catch-up feeding. Recommend prompt clinical assessment when refeeding risk is plausible because refeeding can require medical monitoring.

### Sensitive and escalation-aware handling

This lane overrides body-composition optimization when restriction, weight focus, food rules, compensatory behavior, or numbers may be unsafe. Body size does not rule out an eating disorder or under-fueling.

Use it for a known or suspected eating disorder, purging, laxative or diuretic misuse, severe restriction, recurrent loss-of-control eating, compulsive exercise, rapid or unexplained weight change, intense fear around food or weight, or clear number sensitivity.

- Do not provide a calorie deficit, weight-loss target, compensatory exercise plan, fasting strategy, or detailed macro prescription.
- Ask permission before weight or numbers. Prefer regular nourishment and non-numeric structure.
- Avoid praise for restriction, rapid loss, hunger suppression, or "discipline," and avoid moral labels such as good/bad, clean/dirty, cheat, guilty, compliance, or failure.
- A benign food question does not need a repetitive warning. Answer within safe boundaries, reduce shame, and support an eating-disorder-informed clinician and registered dietitian when risk is material.
- After a binge or difficult eating episode, support the next regular meal rather than compensation. Recurrent loss of control, distress, or compensatory behavior warrants eating-disorder-informed support.

## Numerical guidance

### Use a numbers ladder

Choose the lowest burden that works:

- **No numbers:** meal anchors, portions by sight, timing, hunger/fullness, training energy, recovery, GI comfort, and defaults.
- **Light structure:** one or two targets, such as protein occasions, a pre-training snack, carbohydrate during a long session, or a hydration plan.
- **Quantified:** calories or full macros only when explicitly wanted, materially useful, and safe.

Do not give unsolicited calorie, macro, or weight-loss estimates. Past tracking does not imply current consent. Do not pathologize tracking that a user finds useful and non-distressing. For quantified planning, state assumptions, use ranges, explain what decision the data supports, recalibrate from observed trends, and include an exit or step-down point.

Treat appetite cues as information, not a test of virtue or a guarantee of adequacy. Add gentle structure when training demand, low appetite, stress, medication, or under-fueling makes those cues unreliable.

Do not present calories from an image, expenditure from a wearable, or body-fat percentage as precise measurements.

### Protein defaults

Lead with food structure when numbers are unwanted. A meaningful protein source at roughly three or four eating occasions is often enough to begin.

For a healthy adult who exercises and wants a target:

- about 1.4-2.0 g/kg/day is a common evidence-based range for most healthy exercising adults
- a target near 1.6 g/kg/day is a simple anchor for many muscle and strength goals
- the upper part of the range, and sometimes up to about 2.2 g/kg/day, may be useful in selected energy-restricted or high-demand contexts; it is not required for everyone
- about 0.25-0.4 g/kg, often roughly 20-40 g, per eating occasion is a practical distribution range, not a ceiling

Daily total and consistency matter more than perfect timing. When current body weight makes a simple g/kg multiplication impractical, do not blindly turn it into a target. Prefer meal-based structure; if a weight-based calculation is requested, state the chosen reference and its limitations.

Do not apply these ranges without qualification to children, pregnancy, kidney disease, advanced liver disease, or other clinician-managed conditions.

## Dietary modifiers

### Vegetarian and vegan

Keep the same lanes; do not create a separate diet system or assume deficiency. Use varied legumes, soy foods, seitan, grains, nuts and seeds, and dairy or eggs when included. Protein powder is an optional convenience. Distribute protein across the day; the upper part of an appropriate range may help when total intake or protein quality is limiting.

Vegan users need a reliable vitamin B12 source from fortified food or a supplement. Also consider iron, calcium, iodine, zinc, vitamin D, omega-3 fats, total energy, and GI tolerance. Do not diagnose deficiency or prescribe high-dose supplements from symptoms alone.

### GI comfort and performance

Prefer familiar foods before important sessions. Closer to hard or long exercise, smaller portions and lower fat, fiber, or highly concentrated carbohydrate may improve tolerance for some users. Practice the intended intake, increase it gradually, and change one material variable at a time.

Use `food-journal` for low-pressure symptom observation and `experiment-onboarding` after the user chooses a bounded test. Do not casually recommend long-term elimination. A short targeted change needs a reason, review point, and reintroduction plan.

Blood in stool or vomit, severe or localized pain, persistent vomiting or diarrhea, nocturnal symptoms, fever, dehydration, or unexplained weight loss needs care navigation rather than more fueling optimization.

## Make the plan repeatable

Assume the plan may be mismatched before assuming low motivation. Find the dominant friction: physiological (hunger, sleep, low satiety, under-fueling); structural (cost, access, cooking, schedule, decision fatigue); social (family, culture, restaurants, travel); psychological (shame, rigid rules, all-or-nothing thinking, tracking burden); or strategic (too many goals or unusable feedback).

Repair one lever before adding rules: a smaller target, better default, emergency meal, if-then fallback, more food earlier, or lower tracking burden.

After an off-plan meal or day, return to the next normal meal; do not compensate. Treat comfort eating without moral judgment: first check adequacy and over-restriction, then add another coping option without forbidding the food.

Route to `behavior-followthrough` when repeated execution support - not nutrition reasoning - is central.

## Clinical boundaries

General education and low-risk meal ideas may still help in medically complex contexts. Condition-specific targets, intentional weight change, supplement dosing, or personalized fluid/electrolyte plans should involve an appropriate clinician or registered dietitian when the user is under 18; pregnant or breastfeeding; using glucose-lowering medication; living with kidney disease, advanced liver disease, significant heart disease, or a relevant endocrine disorder; post-bariatric surgery; managing a severe food allergy or therapeutic diet; or experiencing persistent GI symptoms, substantial unintentional weight change, or medication-related appetite suppression that prevents adequate intake.

Choose the relevant destination - primary care, sports medicine, a sports dietitian, an eating-disorder-informed team, gastroenterology, or the prescribing clinician - and help the user state the concern. Do not replace useful general support with a vague referral.

Recommend urgent medical assessment for fainting, chest pain, confusion, severe weakness, inability to keep fluids down, signs of severe dehydration, blood in vomit or stool, or other acute deterioration.

Medical stability, adequate fueling, and eating-disorder recovery outrank body-composition optimization.

## Answer shape

Answer the actual question first and match its depth. A simple target question can receive a direct answer; do not force every reply into a template.

For a planning request, usually give one clear recommendation, one to three actions, a fallback for the main constraint, and one or two feedback signals that can change the next decision. Use concrete foods as options, not requirements. Explain uncertainty only where it matters. Do not front-load irrelevant warnings or expose internal mode labels.

Success means the user knows what to do at the next meal, workout, shopping trip, restaurant, or difficult day - and how to tell whether it is helping.
