---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:eat-less-sodium
slug: eat-less-sodium
title: Eat Less Sodium
summary: Lower sodium by changing the packaged and restaurant foods that contribute most while keeping meals enjoyable.
status: field-testing
quality: usable
aliases:
  - eat less salt
goal:
  category: nutrition
  parentGoalKey: goal_template:eat-balanced-diet
  outcomeKind: behavior
  goalPhrase: eat less sodium
  successSignals:
    - id: lower-sodium-defaults
      kind: behavior
      label: Several high-frequency foods have lower-sodium replacements
    - id: sodium-pattern-sustained
      kind: milestone
      label: The lower-sodium pattern is maintained across four weeks
  evidenceSourceKeys:
    - source_artifact:dietaryguidelines-dietary-guidelines-for-americans-2025-2030-2026-01-01
    - source_artifact:pmid-41914202
  workflow:
    kind: habit_plan
    ownerSkillIds:
      - nutrition-strategy
      - cardiometabolic-health
  startPrompt: Hey Murph, help me eat less sodium.
  indexable: true
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - Get individualized advice for heavy endurance training, high sweat losses, low blood pressure, or a prescribed electrolyte plan.
  notes:
    - Most dietary sodium comes from packaged, prepared, and restaurant foods rather than the salt shaker alone.
---

Eating less sodium usually comes down to changing a few repeat foods. Bread, deli meats, restaurant meals, sauces, soups, snack foods, cheese, and prepared dishes add up because you eat them often. None of it has to taste bland.

## What to do

1. Find the three packaged or restaurant foods you eat most.
2. Compare sodium per serving within a category and replace one item at a time.
3. Rinse canned beans or vegetables when practical, and choose “no salt added” options you like.
4. Flavor home cooking with herbs, spices, citrus, vinegar, garlic, or chiles.
5. At restaurants, ask for sauces or dressings on the side, and balance a higher-sodium meal with ordinary lower-sodium meals, not a punishment fast.

## A simple plan

Start with the foods that repeat; most sodium comes from prepared and packaged food, not the salt shaker.

Week one: save labels or nutrition information for three ordinary days and find the biggest recurring categories: bread, sandwiches, soup, deli meat, cheese, sauces, frozen meals, restaurant food, snack food, or another staple. Don't try for a perfect daily total.

Week two: compare brands or menu choices within the biggest category. A lower-sodium bread eaten twice a day can matter more than a salt-free food you rarely touch. Pick one swap with a real difference that still tastes good.

Week three: change flavor at home with acid, herbs, spices, garlic, onion, chile, toasted seeds, or browning. If you use a lot of salt now, cut back in steps so taste can adapt. Rinse canned beans and vegetables when practical, but keep them if the convenience helps you eat well.

Week four: deal with restaurants. Choose one meal with sauce on the side, fewer cured ingredients, or a simpler preparation. Don't compensate the next day with dehydration or extreme restriction; go back to the usual pattern.

If you monitor blood pressure, keep medicines, caffeine timing, posture, cuff, and routine steady enough to read the trend. Don't mix diet and medication changes without the prescribing clinician.

## How to know it is working

Track labels for a few representative days to find the main sources, then track the specific defaults you changed. If lower blood pressure is the larger goal, use a validated home monitor and go by the average, not one reading.

## What to expect

Taste can adapt over a few weeks. Blood-pressure response varies, so don't assume a lower number without measuring.

## If you get stuck

Frequency before perfection. A modest cut in a daily food can matter more than eliminating a salty food you eat monthly. Restaurant meals often explain why careful home cooking doesn't move the weekly average.

## Make it last

Taste shifts gradually, so favor changes that are almost invisible. Make lower-sodium bread, broth, sauce, or canned food the house default and save deliberate higher-sodium foods for occasions you value. Keep a few seasoning combinations on hand (lemon and herbs, vinegar and garlic, chile and lime, toasted spices) so lower sodium doesn't mean one bland flavor.

Review the plan after travel, a restaurant-heavy month, or a medication change. Weight can jump the day after a sodium-rich meal because of water; don't respond with dehydration or fasting. If blood pressure is the outcome, keep measuring at home under consistent conditions and go by the average. Sodium is one part of care alongside activity, sleep, alcohol, potassium-rich food when safe, medication, and weight when relevant. Lower everyday background intake without making social eating or exercise hydration harder than necessary.

## A quick note

Some people need extra sodium because of high sweat loss or specific medical conditions. Don't override a sodium or fluid plan prescribed by a clinician.

## Sources

- [American Heart Association: Sodium recommendations](https://www.heart.org/en/healthy-living/healthy-eating/eat-smart/sodium/how-much-sodium-should-i-eat-per-day)
- [World Health Organization: Sodium reduction](https://www.who.int/news-room/fact-sheets/detail/salt-reduction)

## Related goals

[Lower My Blood Pressure](/goals/lower-blood-pressure) · [Follow a DASH Diet](/goals/follow-dash-diet) · [Eat Fewer Ultra-Processed Foods](/goals/eat-fewer-ultra-processed-foods)
