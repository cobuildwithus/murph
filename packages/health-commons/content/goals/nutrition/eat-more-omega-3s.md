---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:eat-more-omega-3s
slug: eat-more-omega-3s
title: Eat More Omega-3s
summary: Increase omega-3 intake with appropriate food sources before treating supplements as the default.
status: field-testing
quality: usable
aliases:
  - get more omega-3s
goal:
  category: nutrition
  parentGoalKey: goal_template:eat-balanced-diet
  outcomeKind: behavior
  goalPhrase: eat more omega-3s
  successSignals:
    - id: omega-three-foods
      kind: behavior
      label: Omega-3-rich foods appear regularly across the week
    - id: suitable-source-plan
      kind: milestone
      label: A sustainable fish-based or plant-based source plan is in place
  evidenceSourceKeys:
    - source_artifact:dietaryguidelines-dietary-guidelines-for-americans-2025-2030-2026-01-01
    - source_artifact:pmid-29773586
  workflow:
    kind: habit_plan
    ownerSkillIds:
      - nutrition-strategy
      - micronutrients-supplements
  startPrompt: Hey Murph, help me eat more omega-3s.
  indexable: true
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - Discuss high-dose omega-3 supplements with a clinician if you take anticoagulants or have a bleeding disorder.
  notes:
    - Food guidance and prescription omega-3 treatment are different use cases.
---

Omega-3 fats come in different forms. Fatty fish provide EPA and DHA directly. Flax, chia, walnuts, soy, and canola provide ALA, and the body converts only some of it to EPA and DHA. For most people, a food-first routine is simpler than guessing at supplement doses.

## What to do

If you eat seafood, plan about two fish meals a week and rotate among salmon, sardines, trout, herring, and Atlantic mackerel. Follow current local advice on lower-mercury choices, especially during pregnancy.

If you don't eat fish, include ALA-rich foods most days: ground flax or chia at breakfast, walnuts as a snack, or soy foods in meals. If you avoid all animal foods, you can discuss an algae-derived DHA/EPA supplement with a clinician or dietitian.

## A simple plan

Choose the version that matches how you eat.

**If you eat fish:** list the fish you already like and pick two meals for the coming week. Fatty fish provide more EPA and DHA than many lean fish, and fresh, frozen, and canned all work. Rotate species rather than eating the same fish every day.

**If you don't eat fish:** choose a daily ALA anchor. Add one to two tablespoons of ground flax or chia to oats or yogurt, snack on walnuts, and use soy foods or canola oil when they fit. Whole flax often passes through undigested, so ground flax is more useful.

**If you're considering a supplement:** identify the reason first. A general dietary gap, pregnancy, very high triglycerides, and a clinician-prescribed cardiovascular treatment are different situations. Read the EPA and DHA amounts, not the total "fish oil" weight. Check product testing and discuss dose, interactions, and alternatives with a clinician or pharmacist. Algae oil is a non-fish option.

Try the food plan for four weeks and make it repeatable with a shopping-list default, a canned backup, or a recurring meal.

## How to know it is working

Count fish meals per week or ALA-rich eating occasions. A commercial omega-3 blood score is usually unnecessary for a general food goal and doesn't replace reviewing what you actually eat.

## What to expect

This is a long-term dietary pattern, not something you'll feel after a week. Prescription-dose omega-3 can lower high triglycerides, but that is supervised medical treatment and shouldn't be assumed from ordinary food intake.

## If you get stuck

Use convenient options: canned salmon or sardines, frozen fish, chia or ground flax stirred into foods you already eat, or walnuts kept in sight. If taste is the problem, start with milder fish or mix a small portion into a familiar dish.

## Make it last

Attach omega-3 foods to meals that already happen, such as a fixed weekly fish dinner or ground flax in the same breakfast, with canned fish as backup. Store ground flax and chia properly and discard anything that smells rancid. If household members eat differently, use separate sources rather than making one meal carry the whole plan.

Review seafood choices periodically, since price, sustainability, availability, and advisories change. Mixing frozen, canned, and fresh fish can cut cost. If you take a supplement, record the product, the EPA and DHA amounts, and the reason, and don't stack several oils without noticing the total. Revisit the need when medications change, in pregnancy, or before surgery. A steady, safe source pattern is the goal; don't chase the highest omega-3 index or ignore the rest of the diet.

## A quick note

Check fish advisories during pregnancy and for young children. Supplements vary in dose and quality and can interact with treatment; more isn't automatically better.

## Sources

- [FDA and EPA: Advice about eating fish](https://www.fda.gov/food/consumers/advice-about-eating-fish)
- [NIH Office of Dietary Supplements: Omega-3 fatty acids](https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/)
- [American Heart Association: Seafood and cardiovascular health](https://pubmed.ncbi.nlm.nih.gov/29773586/)

## Related goals

[Eat a Balanced Diet](/goals/eat-balanced-diet) · [Eat Well as a Vegetarian](/goals/eat-well-vegetarian) · [Eat Well as a Vegan](/goals/eat-well-vegan)
