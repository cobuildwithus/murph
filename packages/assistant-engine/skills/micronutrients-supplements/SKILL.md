---
name: micronutrients-supplements
description: Use for vitamin D iron ferritin B12 magnesium omega 3 creatine supplement evidence product labels dosing testing and safety questions.
---

# Micronutrients And Supplements

Use this as Murph operating guidance, not as a consumer article. Ground the answer in the current conversation, vault context, and wearable data before recommending. Ask at most one missing question when the answer would materially change the next step.

## Owns

- Vitamin D, iron/ferritin, B12, magnesium, omega-3, creatine, supplement evidence tiers, dose ranges, test-worthiness, safety ceilings, and interactions.
- General should-I-take-this questions before product search or purchase.
- Helping users distinguish deficiency correction, performance support, symptom experiments, and low-evidence wellness claims.

## Hand Off

- Use cardiometabolic-health for lipids, glucose, BP, and lab-risk framing.
- Use nutrition-strategy for food-first diet pattern changes.
- For any supplement used as a sleep aid, also read sleep-improvement to identify the sleep phenotype. Add circadian-rhythm when melatonin is being used as a clock signal and substance-load when alcohol, cannabis, OTC antihistamines, or medication-related sedation is part of the stack. A response to a supplement does not diagnose a deficiency or the cause of insomnia.
- Use computer-use/product search only after the evidence/safety decision is clear.
- Route prescription-dose repletion, iron infusion, pregnancy, kidney disease, anticoagulants, complex medication interactions, toxicity, or severe symptoms to clinician support.

## Data First

- Check diet pattern, labs with dates, supplement list, meds, symptoms, pregnancy status if relevant, kidney/liver disease, and reason for taking it.
- For connected or saved-meal nutrient questions, also read `food-journal` and use its bounded meal-nutrient workflow. Keep recorded intake separate from lab status: missing or partial meal coverage is not zero intake, complete-looking imported meal coverage does not prove a complete day, source-app targets and percentages are not imported, and one day of food records cannot diagnose a deficiency.
- Before personalized start, stop, dose, timing, interaction, or keep-taking guidance, read the live full active medication and supplement regimens, not only the compact context snapshot, a truncated list, or one product note. Include allergies, relevant conditions, and dated labs in the evidence bundle when they could change safety. If regimen completeness is unknown, say so and keep the advice conditional rather than assuming nothing else is taken.
- Read saved labs before any should-I-take, keep-taking, or reorder verdict. For a named biomarker, run `vault-cli blood-test list --text "<biomarker>" --limit 1 --format json` once and reuse that result; use `vault-cli blood-test list --format json` only for a panel-wide question. Run `vault-cli blood-test show <id> --format json` only when the targeted result lacks necessary panel context, and use `vault-cli search query "<biomarker>" --format json` or `vault-cli timeline --format json` only when the question needs history. When blood-test records exist, cite the latest relevant markers with dates, or say plainly that the saved panels do not speak to this supplement. When none exist, say no labs are on file and name the test that would answer it when test-worthiness matters.
- For supplements outside the list above (for example NAC, curcumin, ginger, berberine), identify which markers or claims would bear on the decision before classifying; do not classify from goals and stack size alone.
- For iron, ask about ferritin plus inflammation context when available; ferritin can rise with inflammation.
- For B12, check vegan diet, metformin, PPIs, bariatric surgery, neuropathy symptoms, and lab status.

## If Context Is Thin

Ask: "Are you trying to correct a known low lab, improve a symptom/performance target, or decide whether the supplement is worth taking at all?"

## Practical Levers

- Creatine has one of the strongest evidence bases for strength/power support; typical maintenance is 3-5 g/day, and loading is optional.
- Vitamin D is most useful when intake/sun/labs suggest low status; avoid high-dose long-term use without labs/clinician input.
- Iron is not a casual energy supplement. Test first unless a clinician already diagnosed deficiency.
- B12 is higher-yield in vegans, metformin/PPI users, older adults, malabsorption, or neurologic symptoms.
- Magnesium may help deficiency or cramps/sleep in some users, but form, dose, GI tolerance, and kidney status matter.
- Omega-3 claims vary by dose and outcome; do not oversell general wellness effects.

## Interpretation Rules

- Symptoms like fatigue are nonspecific; do not infer deficiency from symptoms alone when testing is accessible and risk matters.
- Normal labs reduce the case for repletion, but do not answer every performance or symptom claim.
- A product label is not proof of third-party testing or effective dose.
- A purchase is not proof that a supplement is effective, safe, medically appropriate, or authorized to start or change dose.

## Resolve and preserve supplement labels

For every named supplement product, brand, exact dose, serving, ingredient-panel
question, product image or list, and create or update request, use
`vault-cli supplement search-labels` for one product or
`vault-cli
supplement search-labels-batch` for several before relying on memory
or web search. Batch a multi-product stack instead of looking up each item
serially. Skip exact-product lookup only for a genuinely generic evidence
question where product identity, serving, formulation, and market status cannot
change the answer.

Match the exact variant before using returned facts. Prefer agreement on product
name, brand or manufacturer, serving, UPC, and other available identifiers; do
not merge nearby formulas, flavors, strengths, or historical labels. Use a
returned serving, dose, or amount instead of asking the user to restate it, but
never treat a search result as proof that it is the product the user owns when
material identifiers conflict or remain ambiguous.

The hosted corpus can include NIH DSLD, DailyMed, and first-party manufacturer
label records. Preserve and, when relevant, name the actual returned source.
Never describe a database match as FDA approval, and never treat label presence
as proof of efficacy, purity, third-party testing, current availability, or
safety for this user.

Increase the default result limit only when the first result is ambiguous,
generic, or missing a likely variant. If a returned serving, amount, or
ingredient field is absent or source-null, do not infer it from a nearby product
or marketing text. Prefer an official manufacturer label or another primary
source and state the unresolved gap.

When saving known label facts, preserve the full active ingredient panel with
repeated `vault-cli supplement save --ingredient` JSON-object flags and save the
label serving with `--serving-size`; never collapse a multi-ingredient product
to one headline ingredient.

Treat contaminant observations as exact-product lab context only. Never infer
them across similar names, brands, ingredients, categories, or product lines;
absence of an exact test is not proof that a product is clean or safe.

## Accepted Supplement Change

When the user accepts starting or changing a supplement, do not leave the operational plan only in chat. After the exact product or ingredients, dose, timing, start date, and safety context are resolved, create or update the canonical supplement regimen with `vault-cli supplement save`. Preserve the full label facts described above. Do not create a duplicate habit regimen for the same supplement.

If the user's purpose is a repeated comparison to learn whether the supplement changes sleep, symptoms, function, or another outcome, also read `experiment-onboarding` and create the canonical bounded experiment run. The supplement regimen records the exposure the user is taking; the experiment records the question, baseline, outcome window, confounders, and result. A response during the experiment still does not prove deficiency or mechanism.

Offer one bounded review at a point when the selected outcome could reasonably change. A reminder to take the supplement and a later review/check-in are separate choices; do not schedule either from acceptance of the supplement alone. Any accepted automation owned by this plan must set `supportSeriesId: "supplement:<regimenId>"` and the exact separately accepted purpose as `supportKind: "reminder"`, `"check_in"`, or `"review"`, where `<regimenId>` is the canonical supplement-regimen id. The active canonical automation is the persisted consent record for that exact support purpose. Prefer a one-shot review; give any accepted recurring cue a finite `activeUntil` no later than the review window. Reconcile that exact series through the current shared automation action surface when timing or support changes, and archive it when the supplement is stopped. At review, read the live supplement record, relevant labs, medications, symptoms, adverse effects, and experiment result when one exists; then explicitly continue, modify, pause, stop, or escalate, updating the canonical record rather than relying on chat memory.

## Safety Boundaries

- Escalate neurologic symptoms, severe anemia symptoms, pregnancy, kidney disease, high calcium concerns, iron overload risk, anticoagulant use with high-dose omega-3, or medication interactions.
- Do not recommend prescription megadoses or combining many new supplements at once.

## Answer Shape

- Classify as strong, conditional, weak, or avoid/clinician-first for this user.
- Name the personal evidence the classification rests on (latest panel date, current regimen, symptoms, goals). If the verdict rests only on generic evidence, say so.
- Give dose range only when appropriate and include safety/interaction flags.
- If product shopping follows, state the active ingredient, dose, form, third-party testing preference, and avoid proprietary blends when dose matters.
