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

DASH stands for Dietary Approaches to Stop Hypertension. The plan emphasizes vegetables, fruit, whole grains, beans, nuts, seeds, fish, poultry, and low-fat dairy or suitable alternatives while reducing sodium, processed meat, sweets, and foods high in saturated fat. It is not a branded product or a short cleanse. It is a food pattern that can be adapted to many cuisines.

## What to do

Build meals around foods that naturally supply fiber, potassium, magnesium, calcium, and protein:

- Add fruit or vegetables to several eating occasions each day.
- Choose beans, lentils, nuts, seeds, fish, poultry, tofu, or other lean protein sources often.
- Use whole grains for some of your usual bread, cereal, rice, or pasta choices.
- Include dairy or a nutritionally comparable fortified alternative if it fits your diet.
- Compare sodium across breads, soups, sauces, deli meats, frozen meals, and restaurant orders—the sources eaten often usually matter most.
- Replace butter, fatty meats, and high-saturated-fat snacks with liquid plant oils, nuts, seeds, fish, or other unsaturated-fat sources.

Potassium-rich food is part of the pattern, but potassium supplements and salt substitutes are not appropriate for everyone.

## A simple plan

During week one, do not count every serving. Pick one breakfast and one dinner to repeat. Breakfast might be oats with fruit, nuts, and milk or fortified soy milk. Dinner might be beans or fish, a whole grain or potato, and two vegetables.

In week two, compare labels for three foods you eat often and choose a lower-sodium version that still tastes good. In week three, plan two legume meals and prepare one sauce or seasoning blend using herbs, spices, garlic, citrus, or vinegar. In week four, review restaurant meals and decide on one order that fits the pattern without requiring a special occasion strategy.

If changing everything at once feels unrealistic, prioritize produce and the highest-frequency sodium source. Those two changes create a workable foundation.

## How to know it is working

Track the behaviors you can control: produce-rich meals, bean or lentil meals, lower-sodium swaps, and home-prepared meals. If blood pressure is the target, use a validated upper-arm cuff with proper positioning, take repeated readings under similar conditions, and review the average. One low or high reading does not establish the trend.

## What to expect

Blood pressure can respond within weeks, particularly when a person’s starting sodium intake is high, but the amount varies. Weight loss is not required for DASH to be useful, and DASH does not guarantee that medication can be stopped. Taste preferences may adjust gradually when sodium is reduced rather than removed overnight.

## If you get stuck

If food tastes flat, increase acidity, herbs, spices, toasted aromatics, and texture before adding more salt. If produce is expensive, use frozen and canned choices; rinse canned beans and vegetables when practical. If dairy does not fit, choose a fortified alternative with meaningful protein and calcium rather than assuming all plant drinks are equivalent. If tracking creates too much work, keep a short list of reliable meals instead.

## Make it last

Convert DASH from a serving chart into household defaults. Keep fruit visible, frozen vegetables stocked, a bean meal on the weekly plan, a lower-sodium bread or soup, and a calcium-rich food that fits your diet. Preserve flavor with acids, aromatics, spices, and sauces whose sodium you understand.

Use home blood-pressure averages to connect the behavior with the intended outcome, but do not change the plan every time a reading moves. Review after several weeks, then keep the lightest system that works. Restaurant meals and holidays may be higher in sodium; return to the normal pattern without fasting or excess water. If blood pressure remains above the agreed target, discuss medication, sleep apnea, alcohol, activity, weight, and measurement technique rather than making the diet increasingly restrictive. DASH is sustainable when it is a flexible version of the food you already eat, not a temporary clinic menu.

## A quick note

Kidney disease, heart failure, adrenal conditions, and medicines such as ACE inhibitors, ARBs, or potassium-sparing diuretics can change safe potassium intake. Follow a clinician’s fluid, sodium, or potassium plan when one exists. Very high blood pressure or symptoms such as chest pain, severe headache with neurologic changes, or shortness of breath need prompt medical evaluation.

## Sources

- [National Heart, Lung, and Blood Institute: DASH eating plan](https://www.nhlbi.nih.gov/education/dash-eating-plan)
- [Original DASH randomized feeding trial](https://pubmed.ncbi.nlm.nih.gov/9099655/)
- [American Heart Association: 2025 high blood pressure guideline overview](https://professional.heart.org/en/science-news/2025-high-blood-pressure-guideline/top-things-to-know)

## Related goals

[Lower My Blood Pressure](/goals/lower-blood-pressure) · [Eat Less Sodium](/goals/eat-less-sodium) · [Eat More Fruits and Vegetables](/goals/eat-more-fruits-and-vegetables)
