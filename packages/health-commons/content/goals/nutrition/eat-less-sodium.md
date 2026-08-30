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

Eating less sodium usually means changing a few repeat foods, not making everything taste bland. Bread, deli meats, restaurant meals, sauces, soups, snack foods, cheese, and prepared dishes can contribute large amounts because they are eaten often.

## What to do

1. Identify the three packaged or restaurant foods you eat most often.
2. Compare sodium per serving within the same category and replace one item at a time.
3. Rinse canned beans or vegetables when practical and choose “no salt added” options you enjoy.
4. Flavor home cooking with herbs, spices, citrus, vinegar, garlic, or chiles.
5. At restaurants, ask for sauces or dressings on the side and balance higher-sodium meals with ordinary lower-sodium meals—not a punishment fast.

## A simple plan

Start with the foods that repeat, since most sodium comes from prepared and packaged food rather than a dramatic use of the salt shaker.

In week one, save the labels or nutrition information for three ordinary days. Identify the largest recurring categories: bread, sandwiches, soup, deli meat, cheese, sauces, frozen meals, restaurant food, snack food, or another staple. Do not try to achieve a perfect daily calculation.

In week two, compare brands or menu choices within the biggest category. A lower-sodium bread eaten twice daily can matter more than a salt-free food you rarely eat. Choose one swap with a meaningful difference that still tastes good.

In week three, change flavor at home. Use acid, herbs, spices, garlic, onion, chile, toasted seeds, or browning to build flavor. If you currently use a great deal of salt, reduce it in steps so taste can adapt. Rinse canned beans and vegetables when practical, but keep them if their convenience helps you eat well.

In week four, address restaurants. Choose one meal with sauce on the side, fewer cured ingredients, or a simpler preparation. Avoid compensating with dehydration or an extreme restriction the next day; return to the usual pattern.

If you monitor blood pressure, keep medicines, caffeine timing, posture, cuff, and measurement routine stable enough to interpret the trend. Diet changes and medication changes should not be mixed without the prescribing clinician.

## How to know it is working

Label tracking for a few representative days can reveal the main sources. After that, track the specific defaults you changed. If lowering blood pressure is the larger goal, use a validated home monitor and look at an average rather than one reading.

## What to expect

Taste preferences can adapt over a few weeks. Blood-pressure response varies, and a lower number cannot be assumed without measurement.

## If you get stuck

Focus on frequency before perfection. A modest reduction in a food eaten daily can matter more than eliminating a salty food eaten monthly. Restaurant intake often explains why careful home cooking does not change the weekly average.

## Make it last

Taste changes gradually, so preserve changes that are almost invisible. Use the lower-sodium bread, broth, sauce, or canned food as the house default and save deliberate higher-sodium foods for occasions you value. Keep a small collection of seasoning combinations—lemon and herbs, vinegar and garlic, chile and lime, toasted spices—so lower sodium does not mean one bland flavor.

Review the plan after travel, a restaurant-heavy month, or a medication change. Day-to-day body weight can jump after sodium-rich meals because of water; do not respond with dehydration or fasting. If blood pressure is the outcome, continue home measurements under consistent conditions and review the average. A sodium strategy is one part of care alongside activity, sleep, alcohol, potassium-rich food when safe, medication, and weight when relevant. The best plan lowers the regular background intake without making social eating or exercise hydration unnecessarily difficult.

## A quick note

Some people need extra sodium because of high sweat loss or specific medical conditions. Do not override a clinician-prescribed sodium or fluid plan.

## Sources

- [American Heart Association: Sodium recommendations](https://www.heart.org/en/healthy-living/healthy-eating/eat-smart/sodium/how-much-sodium-should-i-eat-per-day)
- [World Health Organization: Sodium reduction](https://www.who.int/news-room/fact-sheets/detail/salt-reduction)

## Related goals

[Lower My Blood Pressure](/goals/lower-blood-pressure) · [Follow a DASH Diet](/goals/follow-dash-diet) · [Eat Fewer Ultra-Processed Foods](/goals/eat-fewer-ultra-processed-foods)
