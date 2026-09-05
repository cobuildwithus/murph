---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:sleep-better-with-acid-reflux
slug: sleep-better-with-acid-reflux
title: Sleep Better With Acid Reflux
summary: Reduce nighttime reflux with meal timing, sleep positioning, and appropriate treatment of persistent GERD.
status: field-testing
quality: usable
aliases:
  - stop acid reflux at night
  - sleep better with GERD
categories:
  - goals
  - sleep
  - acid-reflux
  - digestion
goal:
  category: sleep
  outcomeKind: symptom
  goalPhrase: sleep better with acid reflux
  successSignals:
    - id: fewer_night_reflux_episodes
      kind: symptom
      label: Fewer nights with reflux symptoms
    - id: fewer_reflux_awakenings
      kind: symptom
      label: Fewer awakenings caused by reflux
    - id: easier_sleep_after_meals
      kind: function
      label: More comfortable sleep after ordinary meals
  evidenceSourceKeys:
    - source_artifact:pmid-34807007
    - source_artifact:pmid-35226174
  workflow:
    kind: general_plan
    ownerSkillIds:
      - gut-digestion
      - sleep-improvement
  startPrompt: Hey Murph, help me sleep better with acid reflux.
  indexable: true
safety:
  cautionLevel: moderate
---

Nighttime reflux usually improves with a longer gap between your last meal and lying down, correct upper-body elevation, and treatment of persistent gastroesophageal reflux disease. Start with meal timing, position, and symptoms rather than cutting a long list of foods without evidence they bother you.

## What to do

- When nighttime symptoms are common, finish your last substantial meal at least three hours before lying down.
- Raise your head and upper torso about 6 to 8 inches with a wedge or bed risers. A pile of pillows may bend the body and work less well.
- Try left-side sleeping if it's comfortable. For some people, anatomy makes reflux less likely there.
- Learn your triggers from experience. Alcohol, high-fat meals, chocolate, mint, coffee, acidic foods, and spicy foods are common, but you needn't restrict them all.
- If weight is contributing, gradual weight loss can reduce GERD symptoms. Avoid crash diets that hurt sleep or nutrition.
- Stop smoking, and review medicines that may affect reflux with a clinician or pharmacist.

## A simple plan

For two weeks, record last meal time, when you lay down, reflux severity, and awakenings. Make one change first: a three-hour gap between dinner and bed, with dinner otherwise unchanged.

If symptoms continue, add proper head-of-bed elevation the next week, and if position seems to matter, compare comfortable left-side nights with usual nights. Don't change everything at once.

Dinner should still be a full meal, just earlier. If your schedule forces a late meal, make it smaller with fewer known triggers and eat the larger meal earlier.

If you use an over-the-counter antacid or acid reducer, follow the label and discuss frequent use with a clinician. Prescription proton-pump inhibitors work best taken at the instructed time, so don't improvise dose changes after one bad night.

## How to know it is working

Count nights with burning, a sour taste, cough, or reflux-related waking, plus sleep disruption and next-day throat symptoms. Improvement should show across similar meals and schedules, not only on nights when you ate very little.

Wearable sleep data can't detect reflux, and a better sleep score doesn't prove your esophagus is protected. Fewer symptoms is a good sign, but persistent GERD may still need medical treatment to prevent complications.

## If you get stuck

Check the mechanics: extra pillows under only the head don't elevate the torso, and a late "small snack" can still set off symptoms. Cough, throat clearing, asthma symptoms, and chest discomfort have other possible causes and shouldn't be labeled reflux by default.

If symptoms happen more than occasionally, wake you regularly, or continue despite appropriate treatment, see a clinician. They can review the diagnosis, medication timing, hiatal hernia, and whether testing or endoscopy is warranted.

## A quick note

Seek urgent care for chest pressure, shortness of breath, vomiting blood, black stools, fainting, or severe pain. Bring trouble swallowing, food sticking, unexplained weight loss, anemia, or persistent vomiting to a clinician promptly.

## Sources

- [NIDDK: treatment for GER and GERD](https://www.niddk.nih.gov/health-information/digestive-diseases/acid-reflux-ger-gerd-adults/treatment)
- [NIDDK: eating and meal timing for GERD](https://www.niddk.nih.gov/health-information/digestive-diseases/acid-reflux-ger-gerd-adults/eating-diet-nutrition)
- [American College of Gastroenterology GERD guideline](https://pubmed.ncbi.nlm.nih.gov/34807007/)
