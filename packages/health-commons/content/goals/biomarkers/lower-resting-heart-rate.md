---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:lower-resting-heart-rate
slug: lower-resting-heart-rate
title: Lower My Resting Heart Rate
summary: "Build aerobic fitness and recovery habits that can lower your personal resting-heart-rate baseline without treating the lowest possible number as the goal."
status: field-testing
quality: usable
aliases:
  - lower my RHR
  - reduce resting heart rate
  - lower resting pulse
goal:
  category: biomarkers
  outcomeKind: biomarker
  goalPhrase: lower my resting heart rate
  successSignals:
    - id: resting-heart-rate-trend
      kind: biomarker
      label: Lower 7-day resting-heart-rate trend
    - id: aerobic-training
      kind: behavior
      label: Complete regular aerobic training
    - id: same-effort-fitness
      kind: capacity
      label: Move faster or longer at the same effort
    - id: recovery
      kind: function
      label: Recover normally between sessions
  evidenceSourceKeys:
    - source_artifact:pmid-30513777
    - source_artifact:health.gov-physical-activity-guidelines-2018-11-12
    - source_artifact:pmid-33239350
    - source_artifact:pmid-32100573
  workflow:
    kind: tracking_plan
    ownerSkillIds:
      - hrv-resting-heart-rate
      - aerobic-fitness
  startPrompt: "Hey Murph, help me lower my resting heart rate."
  indexable: true
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - "Known heart disease, a significant rhythm problem, recent myocarditis or pericarditis, or clinician-directed exercise limits"
    - "A persistent resting heart rate above 100 or unexpectedly below 50 when that is new or unexplained"
  stopIf:
    - "Chest pain, fainting, near-fainting, unusual shortness of breath, a sustained racing or irregular heartbeat, or exercise intolerance occurs"
  notes:
    - "Medications, illness, hydration, heat, sleep, and measurement conditions can change resting heart rate independently of fitness."
---

The most dependable way to lower a high resting-heart-rate baseline is to build aerobic fitness with regular, progressive cardio while recovering well enough to adapt. You are after a stable trend that fits better fitness, normal energy, and no worrying symptoms, not the lowest number you can produce. Genetics, age, medications, illness, heat, hydration, sleep, alcohol, and measurement conditions all move resting heart rate, so read it as one signal, not a grade.

## What to do

Start with a baseline you can trust. For 7 to 14 days, use the same method under similar conditions, ideally after waking, before caffeine, while calm and still. If a wearable calculates resting heart rate automatically, learn when it measures and use its weekly median. Don’t compare its value with a manual daytime pulse or another brand’s algorithm.

Make easy aerobic work the foundation. Brisk walking, cycling, swimming, rowing, and jogging can all work. Start with three repeatable sessions a week at a conversational effort: breathing is up, but you can still talk in full sentences. Build gradually toward the public-health range of 150 to 300 minutes of moderate aerobic activity per week, or a suitable mix of moderate and vigorous work.

Once that base feels routine and vigorous exercise is appropriate for you, add a little harder work. One interval session a week is enough to start. Strength training twice a week helps overall health and durable movement, though aerobic training is the main lever here.

## A simple plan

An eight-week starting structure for someone already cleared for ordinary exercise:

1. **Weeks 1–2:** Do three 25- to 35-minute conversational sessions. Finish feeling you could have done more. Record your morning heart-rate trend without trying to change it day to day.
2. **Weeks 3–4:** Add five minutes to two sessions, or add one short easy session. Keep the total increase modest. Include two simple full-body strength sessions on nonconsecutive days.
3. **Weeks 5–6:** Keep the easy sessions and, if recovery is good, add one controlled interval day: warm up, do four efforts of two minutes at a hard but sustainable pace with two or three easy minutes between them, then cool down.
4. **Weeks 7–8:** Repeat rather than automatically ramping up. If the interval day disrupts sleep, leaves unusual fatigue, or makes the next easy day hard, cut the number of efforts or return to easy training.

Put easier days between hard days. During illness, major sleep loss, dehydration, unusual heat, or a multi-day rise in resting heart rate with fatigue, recovery does more good than trying to exercise the number down.

The plan should improve what you can do, not just pile up training. A brisker walking pace, a familiar hill that feels easier, or a lower heart rate at the same cycling power are real adaptations, even before resting heart rate moves.

## How to know it is working

Compare 7-day medians across four-week blocks. Ignore the single lowest night and note obvious confounders such as fever, alcohol, travel, very hard training, or a medication change. Keep the device, wearing position, and measurement conditions as consistent as you can.

Pair the heart-rate trend with one real-world capacity marker: pace at a conversational effort, distance covered in 30 minutes, cycling power at the same perceived effort, or how winded a familiar staircase leaves you. A lower resting trend alongside better capacity is more convincing than a lower number alone.

Some people see an early change in four to eight weeks; larger changes usually take months. Starting fitness, genetics, age, medications, training dose, and measurement method all affect the response. A modest change can still go with a meaningful gain in fitness, and a flat value does not erase better performance.

## If you get stuck

First ask whether aerobic work is happening regularly and whether duration or capacity has progressed. Then check sleep, illness, alcohol, dehydration, heat, stimulant use, overreaching, and recent medication changes. If pace or endurance is improving while resting heart rate is flat, the plan may already be working.

Don’t reach for more intensity by default. Hard sessions are potent but cost more fatigue, and too many crowd out the repeatable easy volume that builds the base. If your resting heart rate rises for several days alongside fatigue, irritability, poor sleep, or falling performance, take an easier week.

If the number changed abruptly with no obvious cause, verify it manually and ask whether the device fit or algorithm changed. A persistent new pattern, especially with symptoms, deserves medical review, not a more aggressive workout plan.

## A quick note

A low resting heart rate can be normal in trained people, but new or symptomatic bradycardia is different. Get prompt care for chest pain, fainting, marked breathlessness, a sustained racing or irregular pulse, or a major unexplained change. Don’t alter heart or blood-pressure medication to change this number.

## Sources

- [Systematic review and meta-analysis: exercise effects on resting heart rate](https://pubmed.ncbi.nlm.nih.gov/30513777/)
- [Physical Activity Guidelines for Americans, second edition](https://odphp.health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf)
- [World Health Organization guidelines on physical activity and sedentary behavior](https://pubmed.ncbi.nlm.nih.gov/33239350/)
- [American Heart Association: All About Heart Rate](https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/all-about-heart-rate-pulse)
- [AHA scientific statement on exercise-related cardiovascular events](https://pubmed.ncbi.nlm.nih.gov/32100573/)
