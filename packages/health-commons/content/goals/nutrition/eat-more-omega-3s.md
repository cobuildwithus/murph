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

Omega-3 fats come in different forms. Fatty fish provide EPA and DHA directly; flax, chia, walnuts, soy, and canola provide ALA, only some of which the body converts to EPA and DHA. For most people, a food-first routine is simpler than guessing at supplement doses.

## What to do

If you eat seafood, plan roughly two fish meals per week and rotate choices such as salmon, sardines, trout, herring, or Atlantic mackerel. Use current local advice for lower-mercury choices, especially during pregnancy.

If you do not eat fish, include ALA-rich foods most days—for example ground flax or chia in breakfast, walnuts as a snack, or soy foods in meals. People who avoid all animal foods can discuss an algae-derived DHA/EPA supplement with a clinician or dietitian if needed.

## A simple plan

Choose the version that matches how you eat.

**If you eat fish:** list the fish you already like and choose two meals for the next week. Fatty fish such as salmon, sardines, trout, herring, and Atlantic mackerel provide more EPA and DHA than many lean fish. Use fresh, frozen, or canned forms. Rotate species and follow current mercury advice rather than eating the same fish every day.

**If you do not eat fish:** choose a daily ALA anchor. Add one to two tablespoons of ground flax or chia to oats or yogurt, use walnuts as a snack, and include soy foods or canola oil when they fit. Whole flax often passes through undigested, so ground flax is more useful.

**If you are considering a supplement:** first identify the reason. A general dietary gap, pregnancy, very high triglycerides, and a clinician-prescribed cardiovascular treatment are different situations. Read the EPA and DHA amounts rather than the total “fish oil” weight. Check product testing and discuss dose, interactions, and alternatives with a clinician or pharmacist. Algae oil provides a non-fish option.

Try the food plan for four weeks and make it repeatable through a shopping-list default, canned backup, or recurring meal. Do not expect a subjective sensation that proves it works. The main success is the pattern itself; clinical treatment of high triglycerides uses doses and products that should be supervised.

## How to know it is working

Count fish meals per week or ALA-rich eating occasions. A commercial omega-3 blood score is usually unnecessary for a general food goal and does not replace a review of the actual diet.

## What to expect

This is a long-term dietary pattern, not a feeling you should notice after a week. Prescription-dose omega-3 can lower high triglycerides, but that is medical treatment and should not be inferred from ordinary food intake.

## If you get stuck

Use convenient options: canned salmon or sardines, frozen fish, chia or ground flax added to foods you already eat, or walnuts kept visible. If taste is the barrier, start with milder fish or mix a small portion into a familiar dish.

## Make it last

Attach omega-3 foods to meals that already happen. Put one fish dinner on a recurring weekly slot, keep canned fish as a backup, or add ground flax to the same breakfast. Store ground flax or chia appropriately and replace old products that smell rancid. For children or household members with different preferences, use separate sources rather than making one meal carry the entire plan.

Review seafood choices periodically because price, sustainability, availability, and advisories change. A mix of frozen, canned, and fresh fish can reduce cost. If using a supplement, record the product, EPA and DHA amount, and reason for taking it; do not stack multiple oils without noticing the total. Revisit the need during medication changes, pregnancy, or before surgery. The durable goal is a consistent and safe source pattern. It is not a race to the highest omega-3 index or a reason to ignore the rest of the diet.

## A quick note

Check fish advisories during pregnancy and for young children. Supplements vary in dose and quality and can interact with treatment; more is not automatically better.

## Sources

- [FDA and EPA: Advice about eating fish](https://www.fda.gov/food/consumers/advice-about-eating-fish)
- [NIH Office of Dietary Supplements: Omega-3 fatty acids](https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/)
- [American Heart Association: Seafood and cardiovascular health](https://pubmed.ncbi.nlm.nih.gov/29773586/)

## Related goals

[Eat a Balanced Diet](/goals/eat-balanced-diet) · [Eat Well as a Vegetarian](/goals/eat-well-vegetarian) · [Eat Well as a Vegan](/goals/eat-well-vegan)
