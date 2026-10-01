---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:stay-hydrated
slug: stay-hydrated
title: Stay Hydrated
summary: Build a simple drinking routine that keeps pace with daily life, exercise, and heat.
status: field-testing
quality: usable
aliases:
  - drink enough water
  - improve my hydration
goal:
  category: nutrition
  parentGoalKey: goal_template:eat-balanced-diet
  outcomeKind: behavior
  goalPhrase: stay hydrated
  successSignals:
    - id: regular-fluid-intake
      kind: behavior
      label: Fluids are consumed regularly across the day
    - id: exercise-hydration-ready
      kind: milestone
      label: A repeatable hydration plan covers exercise and hot days
  evidenceSourceKeys:
    - source_artifact:pmid-28332116
    - source_artifact:pmid-19541738
  workflow:
    kind: habit_plan
    ownerSkillIds:
      - nutrition-strategy
      - behavior-followthrough
  startPrompt: Hey Murph, help me stay hydrated.
  indexable: true
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - Follow individualized fluid limits for heart, kidney, or liver disease.
  notes:
    - More water is not always better; avoid forcing large volumes quickly.
---

Good hydration is a routine, and there's no precise water target that fits everyone. Needs shift with body size, climate, exercise, pregnancy, illness, and the water in food. Drink regularly, answer thirst, and plan ahead when you know you'll sweat a lot.

## What to do

- Drink with meals and after waking.
- Keep a bottle or glass where you already spend time.
- Start exercise normally hydrated instead of catching up halfway through.
- During long, hot, or very sweaty sessions, drink to a plan based on your own experience. Food or an electrolyte drink can replace sodium when losses are large.
- After exercise, go back to normal meals and fluids. Most ordinary workouts don't need a special product.

If you keep finishing long sessions much lighter than you started, weigh yourself before and after under similar conditions to estimate your own sweat loss. Don't borrow someone else's sweat rate.

## A simple plan

Spend the first week watching. Notice when thirst, headache, dry mouth, or rushed drinking tends to show up, and whether long meetings, commuting, exercise, or avoiding bathroom breaks keeps cutting you off from fluid.

For the next two weeks, use three anchors: drink after waking, with each meal, and around exercise. Pick a bottle or glass size you know and refill it when convenient, but don't turn the container into a quota you have to force down. Put the bottle where the behavior happens: the desk, the gym bag, or the travel checklist.

For exercise in ordinary conditions, start hydrated and drink by thirst and experience. For sessions longer than about an hour, hot environments, or heavy sweaters, test a more specific plan. Weigh before and after a representative session in minimal dry clothing. A loss of one kilogram is roughly one liter of net fluid loss, though the estimate has to account for what you drank and any urine. You're not trying to finish heavier than you started.

Let normal meals replace sodium after most workouts. During prolonged exercise or heavy sweat loss, an electrolyte drink or salty food may help. Test it in training rather than copying a generic sodium number.

In week four, look at evening intake. If drinking late disrupts sleep, shift more fluid earlier. Keep the routine that prevents catch-up drinking without constant clear urine or needless bathroom trips.

## How to know it is working

Thirst, urine frequency and color, headache, dry mouth, exercise conditions, and big weight swings around long workouts all give context. Pale urine all day isn't a prize, and one dark sample after waking isn't automatically dehydration.

## What to expect

A cue-based routine can feel automatic within a week or two. Exercise hydration takes a few similar sessions to tune. Day-to-day scale changes usually reflect fluid shifts, not fat.

## If you get stuck

Tie drinking to cues you already have: meals, the commute, meetings, or workout setup. Pick fluids you'll actually drink; water, milk, tea, coffee, and water-rich foods all count. If you forget until evening, spread intake earlier instead of chugging before bed.

## A quick note

Confusion, fainting, being unable to keep fluids down, or severe weakness during heat or exercise needs urgent care. Drinking too much can also be dangerous. Get advice for persistent extreme thirst or unusually frequent urination.

## Sources

- [National Academies: Dietary Reference Intakes for water and electrolytes](https://nap.nationalacademies.org/catalog/10925/dietary-reference-intakes-for-water-potassium-sodium-chloride-and-sulfate)
- [American College of Sports Medicine: Exercise and fluid replacement](https://pubmed.ncbi.nlm.nih.gov/17277604/)
- [CDC: Heat and athletes](https://www.cdc.gov/heat-health/risk-factors/heat-and-athletes.html)

## Related goals

[Fuel My Training](/goals/fuel-my-training) · [Eat a Balanced Diet](/goals/eat-balanced-diet)
