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

A vegan diet can support everyday life and athletic goals if you plan it. The foundation is enough total food plus beans, lentils, soy foods, seitan, peas, nuts, seeds, whole grains, fruit, vegetables, and fortified foods. Vitamin B12 is the one non-negotiable: unfortified plant foods are not a reliable source.

## What to do

Anchor each meal with a substantial protein food: tofu, tempeh, edamame, textured vegetable protein, seitan, beans, lentils, peas, soy milk, or a well-composed meat alternative. Vary grains, legumes, nuts, and seeds through the day.

Make the nutrient plan explicit:

- **Vitamin B12:** use a reliable fortified food or supplement on a schedule that gives you enough. Check the label; nutritional yeast is not always fortified.
- **Calcium:** calcium-fortified plant milk, calcium-set tofu, or other regular sources. Shake fortified drinks before pouring.
- **Vitamin D:** fortified foods, safe sun exposure where appropriate, or a supplement when indicated.
- **Iodine:** iodized salt can help. Seaweed iodine varies widely and can be excessive.
- **Iron and zinc:** legumes, tofu, seeds, fortified grains, and whole grains. Vitamin C improves plant-iron absorption.
- **Omega-3s:** flax, chia, walnuts, canola, or soy. Algae-derived DHA/EPA is worth discussing when appropriate.

## A simple plan

Week one: pick one reliable breakfast and two protein-centered dinners. Oatmeal with fortified soy milk and seeds, tofu stir-fry, lentil curry, bean chili, or seitan with grains and vegetables all work.

Week two: set up the B12 routine and check the calcium on your plant milk or tofu label. Week three: plan portable protein for work or travel. Week four: check that meals give you enough energy, especially if you train hard, have a small appetite, or eat very large volumes of vegetables.

Keep emergency foods on hand: canned beans, shelf-stable soy milk, nut butter, microwavable grains, frozen edamame, baked tofu, or a balanced frozen meal.

## How to know it is working

Track protein anchors per meal and whether the B12 routine actually happens. Review a few typical days for calcium, iron, and total energy rather than logging forever. Steady energy, normal training recovery, comfortable digestion, and weight moving as intended are good signs. Lab tests should follow symptoms, history, and a clinician’s judgment, not a hunt for ideal numbers.

## What to expect

Meals usually get easier within a month. Fiber intake may rise sharply and cause gas or fullness at first. Muscle gain and athletic recovery are possible on vegan eating when protein and total energy are enough. A vegan label does not make a product nutritious, minimally processed, or right for your goal.

## If you get stuck

If you are hungry or losing weight unintentionally, increase portions and add calorie-dense foods: nut butter, tahini, avocado, olive oil, tofu, and grains. If protein is hard, make soy foods, seitan, legumes, or textured vegetable protein the center of the meal, not a garnish. If digestion is uncomfortable, add legumes gradually, use tofu or tempeh, and vary fiber sources. If supplements feel confusing, a dietitian can make a short, minimal plan.

## A quick note

Untreated vitamin B12 deficiency can cause anemia and neurologic injury, sometimes before symptoms are obvious. Seek care for persistent fatigue, numbness, balance changes, weakness, or cognitive changes. Infants and children need age-specific professional guidance; adult plans should not simply be scaled down.

## Sources

- [NIH Office of Dietary Supplements: Vitamin B12](https://ods.od.nih.gov/factsheets/VitaminB12-HealthProfessional/)
- [Dietary Guidelines for Americans, 2025–2030](https://odphp.health.gov/our-work/nutrition-physical-activity/dietary-guidelines/current-dietary-guidelines)
- [NIH Office of Dietary Supplements: Iodine](https://ods.od.nih.gov/factsheets/Iodine-HealthProfessional/)

## Related goals

[Hit My Protein Target](/goals/hit-protein-target) · [Get Enough Calcium](/goals/get-enough-calcium) · [Get Enough Iron](/goals/get-enough-iron)
