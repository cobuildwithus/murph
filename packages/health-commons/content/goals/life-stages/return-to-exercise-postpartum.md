---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:return-to-exercise-postpartum
slug: return-to-exercise-postpartum
title: Return to Exercise Postpartum
summary: Rebuild a postpartum exercise routine gradually through walking, pelvic-floor and core control, strength, and symptom-led progression.
status: field-testing
quality: usable
aliases:
  - start exercising after birth
  - get back to workouts postpartum
categories:
  - goals
  - life-stages
  - postpartum
  - exercise
goal:
  category: life-stages
  parentGoalKey: goal_template:recover-after-giving-birth
  outcomeKind: capacity
  goalPhrase: return to exercise postpartum
  successSignals:
    - id: easy-activity-tolerated
      kind: capacity
      label: Walking and basic movement do not worsen postpartum symptoms
    - id: strength-routine-rebuilt
      kind: behavior
      label: A gradual strength routine happens consistently
    - id: valued-exercise-resumed
      kind: milestone
      label: A valued form of exercise is resumed at a tolerable level
  evidenceSourceKeys:
    - source_artifact:pmid-32217980
    - source_artifact:pmid-40139673
  workflow:
    kind: training_plan
    ownerSkillIds:
      - physical-therapy
      - strength-training
  startPrompt: Hey Murph, help me return to exercise postpartum.
  indexable: true
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - Cesarean surgery, significant tearing, postpartum hemorrhage, infection, high blood pressure, prolapse symptoms, or another complication requires a recovery-specific progression.
  stopIf:
    - Stop and seek care for heavy or increasing bleeding, chest pain, fainting, unusual breathlessness, calf swelling or pain, fever, wound problems, or severe pelvic or abdominal pain.
---

Returning to exercise postpartum works best as a **progression from healing and daily movement to strength and then higher impact**, not a jump from rest to the old program on a calendar date. Some people can begin easy movement within days; cesarean birth, tearing, blood loss, pain, infection, pelvic-floor symptoms, and sleep deprivation may require a slower route.

## What to do

- **Start with ordinary function.** Comfortable walking around the home, stairs, getting off the floor, carrying the baby, and basic self-care are the first load tests. Build these before adding a formal workout.
- **Use symptoms as feedback.** Increasing bleeding, pelvic heaviness, urine or stool leakage, pain, incision pulling, abdominal bulging, or symptoms that remain worse the next day mean the current dose is too high or needs assessment.
- **Reconnect breath, core, and pelvic floor.** Practice quiet 360-degree breathing, a gentle pelvic-floor contraction on the exhale, and full relaxation on the inhale. The goal is coordination, not constant bracing.
- **Build walking gradually.** Begin with five to ten minutes at an easy pace and add a few minutes after several comfortable sessions. A stroller walk counts; so do several short indoor walks.
- **Reintroduce strength before demanding impact.** Sit-to-stands, rows, wall or incline push-ups, light hinges, step-ups, and carries rebuild capacity for daily life. Start with one or two sets and progress load or repetitions slowly.
- **Leave room for recovery.** Feeding, sleep loss, and caregiving change training tolerance. Two short sessions may be more realistic than one long session, and an easy week can be part of progression.
- **Get pelvic-health help when useful.** Leaking, heaviness, pain, a feeling of vaginal bulging, difficulty emptying, or fear of loading are common reasons for pelvic-floor physical therapy.
- **Treat a six-week visit as information, not a magic switch.** Medical clearance can rule out important problems, but readiness for a specific sport depends on healing, symptoms, strength, impact tolerance, and the demands of that activity.

## A simple plan

For the first two weeks of this plan, walk for 5 to 15 minutes on four days and complete two short sessions with sit-to-stands, band rows, incline push-ups, light hip hinges, and calf raises. Use one or two sets of 6 to 10 repetitions. Finish with energy left.

For weeks three and four, add five minutes to two walks and a small amount of load to two strength movements if symptoms remain stable during the session and the next day. For weeks five and six, add a third strength set or a low-impact interval such as one minute brisk and two minutes easy. Delay running and jumping until walking, strength, pelvic-floor function, and repeated small impact are comfortable.

## How to know it is working

Look for longer comfortable walks, easier stairs and carrying, more controlled core and pelvic-floor movement, and a routine that does not increase bleeding, heaviness, leaking, or pain. Fitness may return unevenly. Consistent symptom-stable training is more useful than one impressive session followed by several recovery days.

## If you get stuck

Reduce one variable: time, load, impact, or exercise complexity. If a 30-minute walk causes heaviness, try three ten-minute walks. If squats hurt, use a higher chair. If fatigue is overwhelming, check sleep support, food, hydration, anemia, thyroid symptoms, mood, and complications rather than assuming motivation is the issue.

Do not use abdominal appearance alone to decide readiness. Diastasis, scars, pelvic-floor symptoms, and core strength are best judged by function and pressure control. A physical therapist can bridge from rehabilitation to the sport or program you actually want to do.

## A quick note

Stop and seek care for heavy or increasing bleeding, chest pain, fainting, unusual breathlessness, calf swelling or pain, fever, wound problems, or severe pelvic or abdominal pain. Otherwise, step back one level when symptoms persist into the next day.

## Sources

- [ACOG: Physical Activity and Exercise During Pregnancy and the Postpartum Period](https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2020/04/physical-activity-and-exercise-during-pregnancy-and-the-postpartum-period)
- [CDC: Pregnant and Postpartum Activity Guidelines](https://www.cdc.gov/physical-activity-basics/guidelines/healthy-pregnant-or-postpartum-women.html)
- [ACOG: Exercise After Pregnancy](https://www.acog.org/womens-health/faqs/exercise-after-pregnancy)
- [2025 Canadian guideline for physical activity, sedentary behaviour and sleep throughout the first year postpartum](https://pubmed.ncbi.nlm.nih.gov/40139673/)
