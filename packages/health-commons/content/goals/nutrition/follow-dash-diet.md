---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:follow-dash-diet
slug: follow-dash-diet
title: Follow a DASH Diet
summary: Use the flexible DASH eating pattern to support healthier blood pressure without making meals bland or clinical.
status: field-testing
quality: usable
aliases:
  - eat a DASH diet
  - DASH eating plan
goal:
  category: nutrition
  parentGoalKey: goal_template:eat-balanced-diet
  outcomeKind: behavior
  goalPhrase: follow a DASH diet
  successSignals:
    - id: dash-food-pattern
      kind: behavior
      label: Meals regularly include produce, whole grains, legumes, and suitable low-fat dairy or alternatives
    - id: lower-sodium-defaults
      kind: behavior
      label: Several high-frequency foods have lower-sodium defaults
  evidenceSourceKeys:
    - source_artifact:pmid-18237574
    - source_artifact:pmid-41914202
  workflow:
    kind: general_plan
    ownerSkillIds:
      - nutrition-strategy
      - cardiometabolic-health
  startPrompt: Hey Murph, help me follow a DASH diet.
  indexable: true
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - Ask for individualized potassium and mineral guidance with kidney disease or medicines that raise potassium.
  notes:
    - DASH supports blood-pressure care but does not replace prescribed treatment.
---

DASH stands for Dietary Approaches to Stop Hypertension. It emphasizes vegetables, fruit, whole grains, beans, nuts, seeds, fish, poultry, and low-fat dairy or suitable alternatives, and cuts back on sodium, processed meat, sweets, and foods high in saturated fat. It is a food pattern that adapts to many cuisines, not a branded product or a short cleanse.

## What to do

Build meals around foods that naturally supply fiber, potassium, magnesium, calcium, and protein:

- Add fruit or vegetables to several eating occasions a day.
- Choose beans, lentils, nuts, seeds, fish, poultry, tofu, or other lean protein sources often.
- Swap whole grains into some of your usual bread, cereal, rice, or pasta.
- Include dairy or a nutritionally comparable fortified alternative if it fits your diet.
- Compare sodium across breads, soups, sauces, deli meats, frozen meals, and restaurant orders. The ones you eat most often matter most.
- Replace butter, fatty meats, and high-saturated-fat snacks with liquid plant oils, nuts, seeds, fish, or other unsaturated fats.

Potassium-rich food is part of the pattern, but potassium supplements and salt substitutes are not right for everyone.

## A simple plan

In week one, skip counting servings. Pick one breakfast and one dinner to repeat: oats with fruit, nuts, and milk or fortified soy milk; beans or fish with a whole grain or potato and two vegetables.

In week two, compare labels on three foods you eat often and pick a lower-sodium version that still tastes good. In week three, plan two legume meals and make one sauce or seasoning blend from herbs, spices, garlic, citrus, or vinegar. In week four, review restaurant meals and settle on one order that fits the pattern without special effort.

If changing everything at once is unrealistic, start with produce and your most frequent sodium source.

## How to know it is working

Track what you control: produce-rich meals, bean or lentil meals, lower-sodium swaps, and home-cooked meals. If blood pressure is the target, use a validated upper-arm cuff, position it properly, take repeated readings under similar conditions, and review the average. One low or high reading does not make a trend.

## What to expect

Blood pressure can respond within weeks, especially when starting sodium intake is high, but the size of the change varies. Weight loss is not required for DASH to help, and DASH does not guarantee that medication can be stopped. Taste adjusts gradually when sodium is reduced rather than removed overnight.

## If you get stuck

If food tastes flat, add acidity, herbs, spices, toasted aromatics, and texture before reaching for salt. If produce is expensive, use frozen and canned; rinse canned beans and vegetables when practical. If dairy does not fit, choose a fortified alternative with meaningful protein and calcium; plant drinks are not all equivalent. If tracking is too much work, keep a short list of reliable meals instead.

## Make it last

Turn DASH from a serving chart into household defaults. Keep fruit visible, frozen vegetables stocked, a bean meal on the weekly plan, a lower-sodium bread or soup, and a calcium-rich food that fits your diet. Keep flavor with acids, aromatics, spices, and sauces whose sodium you know.

Use home blood-pressure averages to connect the behavior with the outcome, but do not change the plan every time a reading moves. Review after several weeks, then keep the lightest system that works. Restaurant meals and holidays may run high in sodium; go back to the normal pattern without fasting or drinking excess water. If blood pressure stays above the agreed target, discuss medication, sleep apnea, alcohol, activity, weight, and measurement technique instead of making the diet stricter and stricter.

## A quick note

Kidney disease, heart failure, adrenal conditions, and medicines such as ACE inhibitors, ARBs, or potassium-sparing diuretics can change how much potassium is safe. Follow a clinician’s fluid, sodium, or potassium plan when one exists. Very high blood pressure, or symptoms such as chest pain, severe headache with neurologic changes, or shortness of breath, needs prompt medical evaluation.

## Sources

- [National Heart, Lung, and Blood Institute: DASH eating plan](https://www.nhlbi.nih.gov/education/dash-eating-plan)
- [Original DASH randomized feeding trial](https://pubmed.ncbi.nlm.nih.gov/9099655/)
- [American Heart Association: 2025 high blood pressure guideline overview](https://professional.heart.org/en/science-news/2025-high-blood-pressure-guideline/top-things-to-know)

## Related goals

[Lower My Blood Pressure](/goals/lower-blood-pressure) · [Eat Less Sodium](/goals/eat-less-sodium) · [Eat More Fruits and Vegetables](/goals/eat-more-fruits-and-vegetables)
