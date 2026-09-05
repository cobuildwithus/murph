---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:lower-uric-acid
slug: lower-uric-acid
title: Lower My Uric Acid
summary: Lower uric acid for a clear clinical reason using treatment, hydration, weight, and targeted food or alcohol changes.
status: field-testing
quality: usable
aliases:
  - lower serum urate
  - bring down my urate
categories:
  - goals
  - biomarkers
  - joint-health
goal:
  category: biomarkers
  parentGoalKey: goal_template:prevent-gout-attacks
  outcomeKind: biomarker
  goalPhrase: lower my uric acid
  successSignals:
    - id: serum_urate
      kind: biomarker
      label: Serum urate reaches the clinically agreed range
    - id: urate_lowering_actions
      kind: behavior
      label: Medicine and relevant hydration, alcohol, food, and weight actions are sustained
  evidenceSourceKeys:
    - source_artifact:pmid-32391934
  workflow:
    kind: care_support
    ownerSkillIds:
      - cardiometabolic-health
  startPrompt: Hey Murph, help me lower my uric acid.
  indexable: true
safety:
  cautionLevel: moderate
  notes:
    - High uric acid without gout or uric-acid stones does not automatically require drug treatment.
---

Uric acid, usually reported as serum urate, matters most when it is contributing to gout, tophi, or certain kidney stones. A high lab result on its own does not always need medication. Start by naming the outcome: prevent gout attacks, dissolve crystal deposits, reduce uric-acid stones, or monitor a condition that affects urate.

For established gout treated with urate-lowering medicine, a common target is below 6 mg/dL, adjusted to the individual. Reaching it often takes medication, because genetics and kidney handling contribute more than any single food.

## What to do

- **Confirm the reason and target.** Review gout history, tophi, stones, kidney function, medicines, and whether the result was repeated. Don’t turn asymptomatic hyperuricemia into a treatment project without expected benefit.
- **Take urate-lowering medicine consistently when prescribed.** Allopurinol is commonly first-line and is titrated up gradually. Febuxostat and other options fit selected circumstances.
- **Expect temporary flare risk.** Starting or increasing therapy can mobilize crystals and trigger attacks, so clinicians often prescribe short-term prophylaxis.
- **Avoid dehydration.** Drink regularly according to thirst and medical advice, especially with heat, exercise, vomiting, or a history of stones. Forcing extreme water intake is unnecessary.
- **Reduce alcohol excess.** Beer, spirits, and binge patterns can raise urate and trigger gout. A defined reduction trial shows how much alcohol contributes for you.
- **Cut sugary drinks.** Fructose-sweetened beverages are a high-yield target. Whole fruit does not need to be treated like soda.
- **Change purine-heavy foods in proportion.** Large amounts of organ meat and some seafood can matter, but severely restricting all meat, legumes, and vegetables is rarely necessary.
- **Lose excess weight gradually if appropriate.** Sustained loss can help; crash diets, fasting, and ketosis can temporarily raise urate.
- **Review contributing medicines.** Some diuretics and other drugs raise urate. A prescriber can decide whether the benefit still outweighs that effect.

## A simple plan

Write down the urate value, goal, gout or stone history, kidney function, current medicine and adherence, alcohol, sugary drinks, hydration, and recent weight change. If treatment is indicated, agree on a gradual titration and lab schedule.

For eight weeks, take therapy as prescribed, replace sugary drinks, avoid alcohol binges, keep hydration steady, and lose weight gradually rather than crashing. Record gout attacks and stone symptoms. Recheck urate once the medicine has been at a stable dose long enough to interpret.

## How to know it is working

The biomarker signal is serum urate reaching and staying in the range chosen for the clinical problem. The signals that matter to you come later: fewer gout attacks, shrinking tophi, or fewer uric-acid stones. Track both. A low result from a brief extreme diet is worth less than a stable result on a plan you can maintain.

## What to expect

Medication can lower urate within weeks, but existing crystals dissolve slowly, and flares may get more frequent before they get rarer. In established gout, diet and alcohol changes usually do less than adequately dosed medication, but they can reduce triggers and improve blood pressure, liver, and metabolic health.

Once urate is controlled, it generally needs to stay controlled. The first on-target result is not permission to stop therapy or skip follow-up. Agree on how often to recheck, what to do during illness or dehydration, and how long flare prevention should continue. If the goal is uric-acid stones rather than gout, urine chemistry, urine volume, and stone composition may change the plan; serum urate is only one part of it.

## If you get stuck

Check missed doses, incomplete titration, kidney function, ongoing alcohol binges, dehydration, and medicines that raise urate. If the number is at target but attacks continue, the crystal burden may need more time, or the diagnosis may need review. If urate is high without symptoms, ask whether lowering it would improve an outcome before adding treatment.

## A quick note

A new rash, facial swelling, fever, or systemic illness after starting allopurinol needs prompt medical attention. Sudden severe side or back pain, inability to urinate, or fever with urinary symptoms may signal a complicated stone or infection.

## Sources

- [American College of Rheumatology: 2020 guideline for the management of gout](https://rheumatology.org/gout-guideline)
- [NIAMS: gout causes and treatment](https://www.niams.nih.gov/health-topics/gout)
- [NIDDK: eating, diet, and nutrition for kidney stones](https://www.niddk.nih.gov/health-information/urologic-diseases/kidney-stones/eating-diet-nutrition)

## Related goals

[Prevent Gout Attacks](/goals/prevent-gout-attacks) · [Protect My Kidney Function](/goals/protect-kidney-function) · [Lower My Triglycerides](/goals/lower-triglycerides)
