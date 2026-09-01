---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:hit-protein-target
slug: hit-protein-target
title: Hit My Protein Target
summary: "Choose a protein target that fits your body and goals, then reach it with repeatable meals instead of turning every day into a macro puzzle."
status: field-testing
quality: usable
aliases:
  - eat enough protein
  - reach my daily protein goal
  - increase protein intake
goal:
  category: nutrition
  outcomeKind: behavior
  goalPhrase: hit my protein target
  successSignals:
    - id: daily-protein
      kind: behavior
      label: Reach the chosen daily protein range
    - id: protein-meals
      kind: behavior
      label: Include a protein anchor in regular meals
    - id: training-recovery
      kind: function
      label: Support training and recovery
  evidenceSourceKeys:
    - source_artifact:usda-hhs-dietary-guidelines-2026-01-07
    - source_artifact:pmid-35187864
    - source_artifact:pmid-36057893
  workflow:
    kind: habit_plan
    ownerSkillIds:
      - nutrition-strategy
  startPrompt: "Hey Murph, help me hit my protein target."
  indexable: true
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - "Chronic kidney disease, reduced kidney function, significant liver disease, recurrent kidney stones, or clinician-directed protein limits"
    - "Pregnancy, an eating disorder, unexplained weight loss, or medically complex undernutrition"
  stopIf:
    - "The plan crowds out total energy, fiber-rich foods, or medically necessary nutrition"
  notes:
    - "A higher number is not automatically better, and supplements are optional."
---

Hitting a protein target is easiest when the number is realistic and ordinary meals do most of the work. For generally healthy adults, the basic recommended allowance is 0.8 grams per kilogram of body weight per day. Healthy adults who train regularly—especially with resistance training, including during a calorie deficit—often use a higher range of roughly 1.2 to 1.6 g/kg/day to support muscle. Health, total energy intake, body size, and training still matter. More is not automatically better.

## What to do

Choose a working range rather than a perfect single number. Convert pounds to kilograms by dividing by 2.2, then multiply by the intake that fits your situation. For example, a 165-pound person is about 75 kilograms: 0.8 g/kg is 60 grams, 1.2 g/kg is 90 grams, and 1.6 g/kg is 120 grams per day. These are examples, not personalized prescriptions.

Audit three ordinary days, including one weekend day. You only need enough detail to see where the gaps are. Breakfast and lunch are common weak points. Add one dependable protein “anchor” to the weakest meal before rebuilding the entire day.

Spread useful portions across three or four eating occasions. For many healthy, exercising adults, roughly 25 to 40 grams in a meal is practical, though body size and the daily target matter. Food options include Greek yogurt, eggs, cottage cheese, milk or fortified soy milk, tofu, tempeh, lentils, beans, fish, poultry, lean meat, seitan, or a grain-and-legume combination. Supplements are optional convenience, not a requirement.

## A simple plan

Use this one-week setup, then repeat it:

1. **Pick the range.** Use 0.8 g/kg/day as the general adult RDA/reference target, not a universal personalized floor. If you are a generally healthy adult who trains regularly, consider roughly 1.2 to 1.6 g/kg/day when building or preserving muscle is a meaningful goal. If you have a relevant medical condition or are not sure the range fits your situation, get an individualized target first.
2. **Choose three anchors.** Pick one reliable option for breakfast, lunch, and dinner. Write the approximate protein amount next to each; package labels and a reputable food database are sufficient.
3. **Close the remaining gap.** If the three meals leave 15 to 25 grams, add a purposeful snack such as yogurt, cottage cheese, edamame, milk, soy milk, or a shake. Do not turn all-day grazing into the default.
4. **Prepare for the hard context.** Keep a portable option for travel, work, or the period after training. Convenience is often the real bottleneck.
5. **Protect the rest of the diet.** Keep fruits, vegetables, whole grains or other fiber-rich carbohydrates, and sources of unsaturated fat in the pattern. A protein target should not crowd out total energy, fiber, or variety.
6. **Review after a week.** If you are consistently far below the range, add to one meal. If you feel overfull or are forcing food late at night, lower an unnecessarily aggressive target or distribute it earlier.

A shake can fill a real gap. If you use one, choose a simple product from a company that provides credible independent testing, especially if you compete in drug-tested sport. Whole foods still contribute vitamins, minerals, fiber, and enjoyment that a powder may not.

## How to know it is working

Track the weekly pattern rather than demanding perfection. Two signals are enough: the number of days within the range and the number of regular meals with a protein anchor. After two weeks, you should be able to reach the target without recalculating every bite.

If the goal is strength or muscle, pair protein consistency with training performance and a monthly body-weight or body-composition trend. Protein supports adaptation; it does not replace progressive resistance training, enough total food, or recovery. Research suggests that increasing protein adds a modest benefit to lean-mass and strength gains during resistance training, with diminishing returns once intake is already adequate.

If the goal is appetite or weight management, notice whether meals are satisfying and whether the plan reduces rebound snacking without creating rigid food rules. A higher protein number is not a win if it makes the diet joyless or causes chronic under-eating.

## If you get stuck

If the target feels difficult, make breakfast or lunch more repeatable, use one portable option, or lower a number that was chosen for aspiration rather than need. Smaller protein-dense foods can work better than enormous portions when appetite is low.

If you hit the target but strength or muscle is not improving, inspect the training program, total calories, sleep, and time horizon before adding more protein. If constipation increases, check fluids and whether protein displaced fruit, vegetables, legumes, and whole grains. If cost is the problem, eggs, dairy, tofu, canned fish, lentils, beans, and textured vegetable protein can be economical anchors.

Do not obsess over meal timing. Total daily intake and repeatable training matter more than finding an exact “anabolic window.” Timing becomes useful after the fundamentals are consistent.

## A quick note

Get individualized guidance before deliberately raising protein if you have kidney disease, reduced kidney function, significant liver disease, recurrent stones, pregnancy, an eating disorder, or unexplained weight loss. Do not use a protein goal to justify chronic under-eating.

## Sources

- [Dietary Guidelines for Americans, 2025–2030](https://odphp.health.gov/our-work/nutrition-physical-activity/dietary-guidelines)
- [Systematic review and meta-analysis of protein intake, muscle mass, and function](https://pubmed.ncbi.nlm.nih.gov/35187864/)
- [Dose-response meta-analysis of protein intake and strength training](https://pubmed.ncbi.nlm.nih.gov/36057893/)
- [International Society of Sports Nutrition position stand on protein and exercise](https://pubmed.ncbi.nlm.nih.gov/28642676/)
