---
name: micronutrients-supplements
description: Use for vitamin D iron ferritin B12 magnesium omega 3 creatine supplement evidence dosing testing and safety questions.
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
- Use computer-use/product search only after the evidence/safety decision is clear.
- Route prescription-dose repletion, iron infusion, pregnancy, kidney disease, anticoagulants, complex medication interactions, toxicity, or severe symptoms to clinician support.

## Data First

- Check diet pattern, labs with dates, supplement list, meds, symptoms, pregnancy status if relevant, kidney/liver disease, and reason for taking it.
- Read saved labs before any should-I-take, keep-taking, or reorder verdict: `vault-cli blood-test list --format json`, then `vault-cli blood-test show <id> --format json` for the relevant panel, and `vault-cli search query "<biomarker>" --format json` or `vault-cli timeline --format json` for history. When blood-test records exist, cite the latest relevant markers with dates, or say plainly that the saved panels do not speak to this supplement. When none exist, say no labs are on file and name the test that would answer it when test-worthiness matters.
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

Use `vault-cli supplement search-labels` for one product or `vault-cli
supplement search-labels-batch` for several before web lookup. Increase the
default result limit only when the first result is ambiguous, generic, or
missing a likely variant. Use a returned serving, dose, or amount instead of
asking the user to restate it. If the database is unavailable or incomplete,
prefer an official manufacturer label or another primary source and state the
gap.

When saving known label facts, preserve the full active ingredient panel with
repeated `vault-cli supplement save --ingredient` JSON-object flags and save the
label serving with `--serving-size`; never collapse a multi-ingredient product
to one headline ingredient.

Treat contaminant observations as exact-product lab context only. Never infer
them across similar names, brands, ingredients, categories, or product lines;
absence of an exact test is not proof that a product is clean or safe.

## Safety Boundaries

- Escalate neurologic symptoms, severe anemia symptoms, pregnancy, kidney disease, high calcium concerns, iron overload risk, anticoagulant use with high-dose omega-3, or medication interactions.
- Do not recommend prescription megadoses or combining many new supplements at once.

## Answer Shape

- Classify as strong, conditional, weak, or avoid/clinician-first for this user.
- Name the personal evidence the classification rests on (latest panel date, current regimen, symptoms, goals). If the verdict rests only on generic evidence, say so.
- Give dose range only when appropriate and include safety/interaction flags.
- If product shopping follows, state the active ingredient, dose, form, third-party testing preference, and avoid proprietary blends when dose matters.
