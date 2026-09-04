---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:fuel-my-training
slug: fuel-my-training
title: Fuel My Training
summary: Match food and fluid to training demands so energy, recovery, and performance remain supported.
status: field-testing
quality: usable
aliases:
  - eat for my workouts
  - improve sports nutrition
goal:
  category: nutrition
  parentGoalKey: goal_template:eat-balanced-diet
  outcomeKind: capacity
  goalPhrase: fuel my training
  successSignals:
    - id: training-energy
      kind: capacity
      label: Energy remains steady enough to complete planned training well
    - id: recovery-nutrition
      kind: behavior
      label: Demanding sessions are followed by adequate food and fluid
    - id: performance-trend
      kind: capacity
      label: Key performance markers improve or remain supported across a training block
  evidenceSourceKeys:
    - source_artifact:pmid-26891166
    - source_artifact:pmid-26920240
    - source_artifact:pmid-28642676
  workflow:
    kind: training_plan
    ownerSkillIds:
      - nutrition-strategy
      - competition-training
      - strength-training
  startPrompt: Hey Murph, help me fuel my training.
  indexable: true
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - Use a sports dietitian for weight-class sports, very high training volume, pregnancy, diabetes, or an eating-disorder history.
  notes:
    - Supplements are secondary to enough food, carbohydrate, protein, fluid, and recovery.
---

Training nutrition should match the work. A short easy session may need nothing beyond ordinary meals. Long endurance work, two-a-day training, tournaments, or a demanding strength block can call for deliberate carbohydrate, protein, fluid, and sodium. The point is to arrive at key sessions fueled, recover before the next one, and keep enough energy available for health as well as performance.

## What to do

Cover the foundations first:

- Eat enough total energy for your training load and body-composition goal.
- Include a substantial protein source at several meals across the day.
- Use carbohydrate as the main adjustable fuel for harder and longer exercise: grains, potatoes, fruit, dairy, legumes, or sports products when convenience and fast digestion matter.
- Start sessions normally hydrated. Replace meaningful fluid and sodium losses during long, hot, or very sweaty training.
- Eat after demanding sessions, especially when another session follows within 24 hours.
- Keep fat, fiber, and unfamiliar foods farther from competition if they reliably cause gut trouble.

Sports drinks, gels, chews, and powders are tools for when ordinary food is impractical, not automatic upgrades.

## A simple plan

Classify sessions as easy, standard, or demanding. On easy days, eat your normal balanced meals. Before a standard session, eat a familiar meal with carbohydrate and some protein one to four hours ahead. For a demanding session longer than about an hour, test carbohydrate and fluid during training instead of waiting for race day.

After training, eat a meal with protein, carbohydrate, and fluid within a practical window. Minute-by-minute timing is rarely necessary unless recovery time is short. A recovery meal might be rice, vegetables, and chicken or tofu; yogurt, oats, and fruit; or a sandwich with milk and fruit.

For two weeks, match food to your three hardest sessions. Keep products, timing, and amounts stable enough to learn what your stomach and performance tolerate.

## How to know it is working

Track perceived energy during training, whether you complete planned work, power or pace at a given effort, strength performance, recovery between sessions, sleep, soreness, and gut symptoms. Weighing before and after long hot sessions helps estimate your sweat loss, but day-to-day scale changes are not a performance grade.

For athletes who menstruate, losing regular cycles can be a warning sign of low energy availability. In all athletes, persistent fatigue, recurrent injury, declining performance, irritability, and frequent illness deserve attention.

## What to expect

Correcting under-fueling can improve energy within days; body composition and performance adaptations take weeks to months. More fuel can temporarily raise scale weight through glycogen and water without meaning unwanted fat gain. Exact carbohydrate, protein, and fluid needs vary widely by sport, duration, intensity, body size, environment, and tolerance.

## If you get stuck

If food sits heavily, eat earlier, reduce fat and fiber close to training, or use a smaller snack. If energy fades late in long sessions, test more carbohydrate or fluid during training. If recovery is poor, check total intake and sleep before buying supplements. If weight loss is a goal but performance is falling, the calorie deficit may be too aggressive. Practice the event plan in training and change one variable at a time.

## A quick note

Fainting, chest pain, confusion, heat-illness symptoms, repeated vomiting, or inability to keep fluids down needs prompt care. Persistent signs of low energy availability, stress fractures, menstrual disruption, low libido, or disordered eating call for sports-medicine and nutrition support. Supplements can contain undeclared or banned substances; tested products reduce but do not eliminate that risk.

## Sources

- [Academy of Nutrition and Dietetics, Dietitians of Canada, and ACSM: Nutrition and athletic performance](https://pubmed.ncbi.nlm.nih.gov/26920240/)
- [International Society of Sports Nutrition: Protein and exercise](https://pubmed.ncbi.nlm.nih.gov/28642676/)
- [Australian Institute of Sport: Sports supplement framework](https://www.ais.gov.au/nutrition/supplements)

## Related goals

[Hit My Protein Target](/goals/hit-protein-target) · [Stay Hydrated](/goals/stay-hydrated) · [Lose Fat and Keep Muscle](/goals/lose-fat-keep-muscle)
