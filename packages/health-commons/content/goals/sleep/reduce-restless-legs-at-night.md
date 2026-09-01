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

Restless legs syndrome typically causes an urge to move the legs with uncomfortable sensations that begin or worsen during rest, improve temporarily with movement, and are worse in the evening or night. It is different from an ordinary muscle cramp. Effective treatment begins by confirming the pattern, reviewing aggravating factors, and checking iron status appropriately.

## What to do

- Describe the sensation and timing. Note whether movement relieves it and whether it is clearly worse at rest and at night.
- Ask a clinician to review ferritin and other iron measures when restless legs is persistent. Brain iron can be relevant even when a basic blood count is normal.
- Review medicines that may worsen symptoms, including some antihistamines, antidepressants, antipsychotics, and anti-nausea drugs. Do not stop prescribed medicine without the prescriber.
- Limit caffeine and alcohol if symptoms track with them, especially later in the day.
- Keep sleep timing regular. Sleep loss can make the sensations and the ability to cope with them worse.
- Use brief movement, walking, stretching, massage, or heat for temporary relief while a longer-term plan is being developed.

## A simple plan

For two weeks, record symptom nights, start time, intensity from 0 to 10, and the degree to which movement helps. Add only major context: caffeine, alcohol, a new medicine, pregnancy, blood donation, or a very short night.

Schedule a primary-care or sleep visit if symptoms are frequent or impair sleep. Bring the pattern and ask specifically about iron studies and medication review. If iron treatment is recommended, follow the dose and monitoring plan rather than buying high-dose iron independently.

During the wait, set a consistent sleep window and a short response for symptoms: five minutes of walking, a gentle calf and thigh stretch, and a warm shower or heating pad if comfortable. The aim is relief without turning bedtime into a long workout.

## How to know it is working

Use symptom nights per week, intensity, time to relief, and sleep delay. Progress can mean fewer nights, milder sensations, or less time lost before sleep. Wearable movement counts cannot diagnose restless legs and may miss the internal urge that defines the condition.

If iron is treated, symptom improvement and repeat laboratory timing should be interpreted with the clinician. More iron is not automatically better, and ferritin can be affected by inflammation.

## If you get stuck

Recheck the diagnosis. Leg cramps cause painful muscle tightening; neuropathy can cause burning or numbness that is not specifically worse at rest; akathisia causes a broader inner restlessness; positional discomfort may not follow an evening pattern.

The 2025 AASM guideline changed the medication landscape. Some dopamine medicines used historically can cause augmentation, in which symptoms start earlier, become stronger, or spread. Current treatment may favor other medication classes depending on the person. If symptoms are worsening on a dopamine drug, contact the prescriber rather than raising the dose yourself.

Pregnancy, kidney disease, and iron deficiency require population-specific management. Sleep apnea can also coexist and should be treated.

## A quick note

Do not take iron without appropriate testing and guidance; excess iron can be harmful. Seek prompt evaluation for one-sided swelling, redness, warmth, sudden weakness, or severe new pain, which are not typical restless legs symptoms.

## Sources

- [AASM clinical practice guideline for restless legs syndrome and periodic limb movement disorder](https://jcsm.aasm.org/doi/10.5664/jcsm.11390)
- [National Institute of Neurological Disorders and Stroke: restless legs syndrome](https://www.ninds.nih.gov/health-information/disorders/restless-legs-syndrome)
