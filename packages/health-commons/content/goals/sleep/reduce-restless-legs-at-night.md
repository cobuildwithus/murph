---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:reduce-restless-legs-at-night
slug: reduce-restless-legs-at-night
title: Reduce Restless Legs at Night
summary: Reduce the evening urge to move by identifying aggravators, checking iron status, and using current evidence-based treatment.
status: field-testing
quality: usable
aliases:
  - calm restless legs at night
  - improve restless legs syndrome
categories:
  - goals
  - sleep
  - restless-legs
goal:
  category: sleep
  outcomeKind: symptom
  goalPhrase: reduce restless legs at night
  successSignals:
    - id: fewer_rls_evenings
      kind: symptom
      label: Fewer evenings with a strong urge to move
    - id: lower_rls_intensity
      kind: symptom
      label: Less intense leg discomfort
    - id: less_sleep_disruption
      kind: function
      label: Less delay or disruption to sleep
  evidenceSourceKeys:
    - source_artifact:pmid-39324694
  workflow:
    kind: care_support
    ownerSkillIds:
      - sleep-improvement
      - micronutrients-supplements
  startPrompt: Hey Murph, help me reduce restless legs at night.
  indexable: true
safety:
  cautionLevel: moderate
---

Restless legs syndrome is an urge to move the legs, usually with uncomfortable sensations, that starts or worsens at rest, eases briefly with movement, and is worse in the evening or night. It isn't an ordinary cramp. Treatment starts by confirming that pattern, reviewing aggravators, and checking iron properly.

## What to do

- Describe the sensation and timing: does movement relieve it, and is it clearly worse at rest and at night?
- If it persists, ask a clinician to check ferritin and other iron measures. Brain iron can matter even when a basic blood count is normal.
- Review medicines that can worsen symptoms, including some antihistamines, antidepressants, antipsychotics, and anti-nausea drugs. Do not stop a prescribed medicine without the prescriber.
- Limit caffeine and alcohol if symptoms track with them, especially later in the day.
- Keep sleep timing regular; sleep loss can make the sensations worse and harder to bear.
- For temporary relief, use brief movement, walking, stretching, massage, or heat.

## A simple plan

For two weeks, record symptom nights, start time, intensity from 0 to 10, and how much movement helps. Add only major context: caffeine, alcohol, a new medicine, pregnancy, blood donation, or a very short night.

If symptoms are frequent or disrupt sleep, book a primary-care or sleep visit, bring the pattern, and ask about iron studies and a medication review. If iron is recommended, follow the dose and monitoring plan rather than buying high-dose iron yourself.

Meanwhile, set a consistent sleep window and a short symptom routine: five minutes of walking, a gentle calf and thigh stretch, and a warm shower or heating pad if comfortable. Don't turn bedtime into a workout.

## How to know it is working

Track symptom nights per week, intensity, time to relief, and sleep delay. Wearable movement counts can't diagnose restless legs and may miss the internal urge that defines it.

If iron is treated, go over symptom changes and repeat-lab timing with the clinician. More iron isn't automatically better, and inflammation can affect ferritin.

## If you get stuck

Recheck the diagnosis. Leg cramps are painful muscle tightening. Neuropathy can cause burning or numbness not specifically worse at rest. Akathisia is a broader inner restlessness. Positional discomfort may not follow an evening pattern.

The 2025 AASM guideline changed the medication landscape. Some dopamine medicines used historically can cause augmentation: symptoms start earlier, get stronger, or spread. Current treatment may favor other drug classes depending on the person. If symptoms worsen on a dopamine drug, contact the prescriber; don't raise the dose yourself.

Pregnancy, kidney disease, and iron deficiency each need their own management, and coexisting sleep apnea should be treated.

## A quick note

Do not take iron without proper testing and guidance; excess iron can be harmful. Get prompt evaluation for one-sided swelling, redness, warmth, sudden weakness, or severe new pain; those aren't typical restless legs symptoms.

## Sources

- [AASM clinical practice guideline for restless legs syndrome and periodic limb movement disorder](https://jcsm.aasm.org/doi/10.5664/jcsm.11390)
- [National Institute of Neurological Disorders and Stroke: restless legs syndrome](https://www.ninds.nih.gov/health-information/disorders/restless-legs-syndrome)
