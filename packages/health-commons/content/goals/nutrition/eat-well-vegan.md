---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:eat-well-vegan
slug: eat-well-vegan
title: Eat Well as a Vegan
summary: Build a complete vegan diet with dependable protein and a deliberate plan for vitamin B12 and other key nutrients.
status: field-testing
quality: usable
aliases:
  - eat a healthy vegan diet
goal:
  category: nutrition
  parentGoalKey: goal_template:eat-balanced-diet
  outcomeKind: behavior
  goalPhrase: eat well as a vegan
  successSignals:
    - id: vegan-protein-pattern
      kind: behavior
      label: Substantial plant protein appears at each main meal
    - id: vegan-b12-plan
      kind: milestone
      label: A reliable vitamin B12 source and schedule are in place
    - id: vegan-nutrient-coverage
      kind: milestone
      label: Calcium, vitamin D, iodine, iron, zinc, and omega-3 sources are reviewed
  evidenceSourceKeys:
    - source_artifact:dietaryguidelines-dietary-guidelines-for-americans-2025-2030-2026-01-01
    - source_artifact:pmid-33599941
  workflow:
    kind: general_plan
    ownerSkillIds:
      - nutrition-strategy
      - micronutrients-supplements
  startPrompt: Hey Murph, help me eat well as a vegan.
  indexable: true
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - Get individualized guidance during pregnancy, childhood, significant illness, or eating-disorder recovery.
  notes:
    - A dependable vitamin B12 source is essential in a vegan diet.
---

A healthy vegan diet can support everyday life and athletic goals, but it should be planned rather than defined only by what it excludes. The foundation is enough total food plus beans, lentils, soy foods, seitan, peas, nuts, seeds, whole grains, fruit, vegetables, and fortified foods. Vitamin B12 is the non-negotiable planning point because unfortified plant foods are not a reliable source.

## What to do

Anchor each meal with a substantial protein food: tofu, tempeh, edamame, textured vegetable protein, seitan, beans, lentils, peas, soy milk, or an appropriately composed meat alternative. Include varied grains, legumes, nuts, and seeds across the day.

Build an explicit nutrient plan:

- **Vitamin B12:** use a reliable fortified food or supplement with a schedule that provides enough B12; check the label rather than assuming nutritional yeast is fortified.
- **Calcium:** choose calcium-fortified plant milk, calcium-set tofu, or other regular sources. Shake fortified drinks before using.
- **Vitamin D:** use fortified foods, safe sun exposure where appropriate, or a supplement when indicated.
- **Iodine:** iodized salt can help, but seaweed iodine is highly variable and can be excessive.
- **Iron and zinc:** legumes, tofu, seeds, fortified grains, and whole grains contribute; vitamin C improves plant-iron absorption.
- **Omega-3s:** include flax, chia, walnuts, canola, or soy. Algae-derived DHA/EPA is an option to discuss when appropriate.

## A simple plan

For week one, select one reliable breakfast and two protein-centered dinners. Examples include oatmeal made with fortified soy milk and seeds; tofu stir-fry; lentil curry; bean chili; or seitan with grains and vegetables.

In week two, establish the vitamin B12 routine and verify calcium on the label of your plant milk or tofu. In week three, plan portable protein for work or travel. In week four, review whether meals provide enough energy—especially if you train hard, have a small appetite, or eat very high volumes of vegetables.

Keep emergency foods available: canned beans, shelf-stable soy milk, nut butter, microwavable grains, frozen edamame, baked tofu, or a balanced frozen meal.

## How to know it is working

Track protein anchors per meal and whether your B12 routine actually happens. Review several representative days for calcium, iron, and total energy rather than continuously logging forever. Stable energy, normal training recovery, a comfortable digestion pattern, and weight moving in the intended direction are useful signals. Laboratory testing should be guided by symptoms, history, and a clinician—not used to chase ideal numbers without context.

## What to expect

The meal pattern usually becomes easier within a month. Fiber intake may rise sharply and can initially cause gas or fullness. Muscle gain and athletic recovery are possible with vegan eating when protein and total energy are sufficient. A vegan label does not guarantee that a product is nutritious, minimally processed, or appropriate for your goal.

## If you get stuck

If you are hungry or losing weight unintentionally, increase portions and use calorie-dense foods such as nut butter, tahini, avocado, olive oil, tofu, and grains. If protein seems difficult, make soy foods, seitan, legumes, or textured vegetable protein the center of meals instead of treating them as garnish. If digestion is uncomfortable, increase legumes gradually, use tofu or tempeh, and vary fiber sources. If supplements feel confusing, a dietitian can turn them into a simple, minimal plan.

## A quick note

Untreated vitamin B12 deficiency can cause anemia and neurologic injury, sometimes before symptoms are obvious. Seek care for persistent fatigue, numbness, balance changes, weakness, or cognitive changes. Infants and children need age-specific professional guidance; adult plans should not simply be scaled down.

## Sources

- [NIH Office of Dietary Supplements: Vitamin B12](https://ods.od.nih.gov/factsheets/VitaminB12-HealthProfessional/)
- [Dietary Guidelines for Americans, 2025–2030](https://odphp.health.gov/our-work/nutrition-physical-activity/dietary-guidelines/current-dietary-guidelines)
- [NIH Office of Dietary Supplements: Iodine](https://ods.od.nih.gov/factsheets/Iodine-HealthProfessional/)

## Related goals

[Hit My Protein Target](/goals/hit-protein-target) · [Get Enough Calcium](/goals/get-enough-calcium) · [Get Enough Iron](/goals/get-enough-iron)
