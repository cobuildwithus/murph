---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:get-enough-iron
slug: get-enough-iron
title: Get Enough Iron
summary: Improve iron intake with food choices matched to your needs while treating suspected deficiency as a test-and-treat problem.
status: field-testing
quality: usable
aliases:
  - eat more iron
goal:
  category: nutrition
  parentGoalKey: goal_template:eat-balanced-diet
  outcomeKind: behavior
  goalPhrase: get enough iron
  successSignals:
    - id: iron-foods-regularly
      kind: behavior
      label: Iron-rich foods appear regularly in the weekly pattern
    - id: confirmed-deficiency-followup
      kind: milestone
      label: Any confirmed deficiency has a clinician-led follow-up plan
  evidenceSourceKeys:
    - source_artifact:dietaryguidelines-dietary-guidelines-for-americans-2025-2030-2026-01-01
    - source_artifact:usda-hhs-dietary-guidelines-2026-01-07
  workflow:
    kind: general_plan
    ownerSkillIds:
      - nutrition-strategy
      - micronutrients-supplements
  startPrompt: Hey Murph, help me get enough iron.
  indexable: true
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - Do not start high-dose iron for fatigue without confirming the cause.
  stopIf:
    - Stop self-treatment and seek care for severe abdominal pain, vomiting, or accidental ingestion by a child.
  notes:
    - Iron supplements can cause harm and should be stored securely.
---

Iron is needed to carry oxygen and support many enzymes. Meat and seafood provide heme iron, which is absorbed more readily; beans, lentils, tofu, fortified cereals, seeds, and leafy greens provide nonheme iron. People who menstruate, are pregnant, donate blood often, or eat no animal products may need closer attention.

## What to do

Include an iron-rich food most days. Pair plant sources with vitamin C—such as beans with tomatoes, tofu with peppers, or fortified cereal with fruit—to improve absorption. Tea and coffee can reduce nonheme iron absorption when consumed with the same meal, so move them away from an iron-focused meal if intake is a concern.

Do not use liver as a universal fix, especially during pregnancy, because of its high preformed vitamin A content.

## A simple plan

Begin with food unless a clinician has diagnosed deficiency and prescribed treatment.

In week one, identify the iron sources in three ordinary days. Heme sources include meat and seafood. Nonheme sources include lentils, beans, tofu, fortified cereal, pumpkin seeds, and leafy greens. Note coffee or tea consumed with the same meals and whether vitamin C foods are present.

In week two, choose one dependable iron-rich meal. Examples include lentil curry with tomatoes, tofu and peppers, fortified cereal with berries, bean chili, or meat with vegetables. Use a vitamin C source with plant iron and move tea or coffee an hour or two away when practical.

In week three, add a second source and improve repeatability. Keep canned legumes, frozen vegetables, fortified cereal, tofu, eggs, tinned fish, or another suitable food available. People eating vegetarian or vegan diets may need more deliberate planning because nonheme iron is absorbed less efficiently.

In week four, decide whether testing is needed based on symptoms and risk. If iron deficiency has been confirmed, follow the prescribed supplement dose and recheck schedule. Do not judge correction from energy alone. Ask what caused the deficiency—heavy menstrual bleeding, blood donation, pregnancy, inadequate intake, gastrointestinal blood loss, or malabsorption—because replacement without fixing the cause may be temporary.

Keep iron pills away from children. Accidental overdose can be fatal. If side effects make a prescribed plan hard to follow, ask about alternate dosing, formulations, or intravenous treatment rather than stopping without a replacement plan.

## How to know it is working

Track iron-rich eating occasions for a few weeks. If deficiency is suspected or already diagnosed, symptoms alone cannot show whether it is corrected; follow the blood-testing plan your clinician recommends, usually including the context around hemoglobin and iron stores.

## What to expect

Food habits can improve quickly, but correction of iron-deficiency anemia takes time and depends on fixing the cause of iron loss as well as replacing iron. More iron will not improve energy when iron deficiency is not the problem.

## If you get stuck

Use fortified cereal, beans, lentils, tofu, or a tolerated animal source as a repeatable anchor. If supplements cause side effects, do not abandon treatment silently; a clinician can adjust form, dose, or schedule and investigate ongoing blood loss.

## Make it last

Keep one iron-rich breakfast or lunch and one dinner in regular rotation. Pair the plant-based options with vitamin C automatically: berries with fortified cereal, peppers with tofu, tomatoes with lentils, or citrus with beans. If tea or coffee is an important ritual, move it away from the most iron-focused meal rather than removing it entirely.

Review the plan when menstrual bleeding, pregnancy, blood donation, endurance training, or diet changes alter risk. People with previously diagnosed deficiency need the agreed recheck even if they feel better; symptoms can improve before stores are replenished, and some people remain deficient without dramatic symptoms. Conversely, do not continue iron indefinitely after the reason has ended. Too much iron can be harmful, particularly with iron-overload conditions. The lasting system connects food, the cause of deficiency, any prescribed replacement, and follow-up. It does not turn every tired day into a reason for another supplement.

## A quick note

Unexplained iron deficiency—especially in men or postmenopausal adults—needs evaluation. Black or bloody stools, fainting, chest pain, or shortness of breath require prompt care.

## Sources

- [NIH Office of Dietary Supplements: Iron](https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/)
- [Dietary Guidelines for Americans, 2025–2030](https://odphp.health.gov/our-work/nutrition-physical-activity/dietary-guidelines/current-dietary-guidelines)

## Related goals

[Eat Well as a Vegetarian](/goals/eat-well-vegetarian) · [Eat Well as a Vegan](/goals/eat-well-vegan) · [Recover From Iron-Deficiency Anemia](/goals/recover-from-iron-deficiency-anemia)
