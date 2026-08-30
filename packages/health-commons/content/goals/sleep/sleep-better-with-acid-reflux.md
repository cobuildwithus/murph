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

Nighttime reflux often improves when there is more time between the last meal and lying down, the upper body is elevated correctly, and persistent gastroesophageal reflux disease is treated. Start with the pattern—meal timing, position, and symptoms—rather than eliminating a long list of foods without evidence that they bother you.

## What to do

- Finish the last substantial meal at least three hours before lying down when nighttime symptoms are common.
- Elevate the head and upper torso by about 6 to 8 inches using a wedge or bed risers. A pile of pillows may bend the body and be less effective.
- Try left-side sleeping if it is comfortable; anatomy can make reflux less likely in that position for some people.
- Identify personal triggers from repeated experience. Common possibilities include alcohol, high-fat meals, chocolate, mint, coffee, acidic foods, and spicy foods, but universal restriction is unnecessary.
- If weight is a relevant contributor, gradual weight loss can reduce GERD symptoms. Avoid crash diets that worsen sleep or nutrition.
- Stop smoking and review medicines that may affect reflux with a clinician or pharmacist.

## A simple plan

For two weeks, record the final meal time, time you lay down, nighttime reflux severity, and awakenings. Choose one change first: a three-hour meal-to-bed gap. Keep dinner otherwise normal so the result is interpretable.

If symptoms continue, add proper head-of-bed elevation for the next week. If position matters, compare comfortable left-side and usual nights. Do not change meal timing, food list, pillows, and medication all at once.

Keep dinner nutritionally adequate while changing its timing. Skipping food all evening can create hunger and is not required. If the schedule forces a late meal, test a smaller portion with less of your known trigger foods and keep the more substantial meal earlier. The aim is a sustainable pattern, not fear of eating after an arbitrary clock time.

If you use an over-the-counter antacid or acid-reducing medicine, follow the label and discuss frequent use with a clinician. Prescription proton-pump inhibitors work best when taken at the instructed time; do not improvise dose changes based on one night.

## How to know it is working

Count nights with burning, sour taste, cough, or reflux-related waking. Also track sleep disruption and next-day throat symptoms. Improvement should be apparent across similar meals and schedules, not only on nights when you ate very little.

Wearable sleep data cannot identify reflux. A lower heart rate or better sleep score does not prove the esophagus is protected. Symptom improvement is useful, but persistent GERD may still need medical treatment to prevent complications.

## If you get stuck

Check the mechanics. Extra pillows under only the head are not the same as elevating the torso. A late “small snack” may still trigger symptoms. Cough, throat clearing, asthma symptoms, and chest discomfort have other possible causes and should not automatically be labeled reflux.

If symptoms occur more than occasionally, wake you regularly, or continue despite appropriate treatment, see a clinician. They can review diagnosis, medication timing, hiatal hernia, and whether testing or endoscopy is warranted.

## A quick note

Seek urgent care for chest pressure, shortness of breath, vomiting blood, black stools, fainting, or severe pain. Promptly discuss trouble swallowing, food sticking, unexplained weight loss, anemia, or persistent vomiting with a clinician.

## Sources

- [NIDDK: treatment for GER and GERD](https://www.niddk.nih.gov/health-information/digestive-diseases/acid-reflux-ger-gerd-adults/treatment)
- [NIDDK: eating and meal timing for GERD](https://www.niddk.nih.gov/health-information/digestive-diseases/acid-reflux-ger-gerd-adults/eating-diet-nutrition)
- [American College of Gastroenterology GERD guideline](https://pubmed.ncbi.nlm.nih.gov/34807007/)
