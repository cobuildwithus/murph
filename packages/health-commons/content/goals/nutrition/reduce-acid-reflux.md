---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:reduce-acid-reflux
slug: reduce-acid-reflux
title: Reduce Acid Reflux
summary: Cut heartburn and regurgitation with meal timing, your own trigger list, and the right treatment.
status: field-testing
quality: usable
aliases:
  - reduce heartburn
  - manage GERD symptoms
goal:
  category: nutrition
  parentGoalKey: goal_template:improve-digestion
  outcomeKind: symptom
  goalPhrase: reduce acid reflux
  successSignals:
    - id: reflux-days
      kind: symptom
      label: Heartburn or regurgitation occurs less often or is less intense
    - id: nighttime-reflux
      kind: symptom
      label: Nighttime reflux and reflux-related sleep disruption decrease
    - id: reflux-routine
      kind: behavior
      label: Helpful timing, meal, and treatment habits are followed consistently
  evidenceSourceKeys:
    - source_artifact:pmid-34807007
    - source_artifact:pmid-35123084
    - source_artifact:pmid-33883899
  workflow:
    kind: general_plan
    ownerSkillIds:
      - gut-digestion
      - nutrition-strategy
  startPrompt: Hey Murph, help me reduce acid reflux.
  indexable: true
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - Get frequent, persistent, or treatment-resistant reflux assessed.
  stopIf:
    - Seek prompt care for chest pain, vomiting blood, black stool, progressive difficulty swallowing, persistent vomiting, or significant unintended weight loss.
  notes:
    - Chest pain should not automatically be assumed to be reflux.
---

Acid reflux is stomach contents moving up into the esophagus, usually felt as heartburn or regurgitation. Occasional symptoms often respond to changes in meal timing and position. Frequent symptoms can mean gastroesophageal reflux disease and may need medication or testing. Aim to reduce the patterns that bother you without banning a generic list of foods you tolerate fine.

## What to do

Start with the measures that pay off most:

- If nighttime symptoms are the problem, leave about three hours between your last substantial meal and lying down.
- Cut back on very large meals, especially late in the day.
- Find your own triggers instead of automatically dropping coffee, tomatoes, citrus, chocolate, mint, spicy food, and every high-fat food.
- If higher body weight contributes and weight loss is appropriate, gradual loss can improve symptoms.
- Stop smoking and cut alcohol if either worsens reflux.
- For nighttime reflux, raise the head of the bed with a wedge or bed risers, not stacked pillows.
- Take prescribed acid-suppressing medicine correctly. Timing matters for proton-pump inhibitors.

Skip bending, heavy straining, or hard exercise right after a large meal if that reliably sets off symptoms.

## A simple plan

Track symptoms for a week along with meal timing and size, bedtime, body position, alcohol, and your main suspected trigger. Pick the strongest pattern.

If symptoms hit at night, move dinner earlier or make it smaller for two weeks, and raise the head of the bed. If you strongly suspect one food, remove only that food for a set period, then bring it back. If symptoms happen more than occasionally, ask a clinician or pharmacist whether an evidence-based medication trial makes sense and how to take it.

Review after two to four weeks. Keep changes that clearly help and bring back foods that didn't matter.

## How to know it is working

Track symptom days per week, nighttime awakenings, rescue-antacid use, regurgitation, and interference with meals or activity. Fewer symptoms and less medication, under a clinician's guidance, is a better target than trying to change stomach acidity with consumer tests.

## What to expect

Meal timing and positioning can help within days. Acid-suppressing medicines may take several days to reach full effect. Some people have reflux hypersensitivity or other conditions that mimic reflux, so symptoms that persist despite appropriate treatment are no reason for endless food restriction.

## If you get stuck

Check medication timing and adherence with a clinician. Review constipation, large late meals, alcohol, smoking, and weight change. If your main symptoms are throat clearing, cough, or hoarseness without typical heartburn, consider other causes. Persistent symptoms may call for endoscopy or reflux monitoring, depending on age, history, and alarm features.

## A quick note

Chest pressure with exertion, sweating, shortness of breath, pain spreading to the arm or jaw, or a new severe episode needs urgent evaluation. Difficulty swallowing, food sticking, bleeding, anemia, persistent vomiting, or weight loss also needs medical care. Don't stop a prescribed proton-pump inhibitor abruptly without discussing the plan.

## Sources

- [American College of Gastroenterology: GERD guideline](https://pubmed.ncbi.nlm.nih.gov/34807007/)
- [AGA: Personalized evaluation and management of GERD](https://pubmed.ncbi.nlm.nih.gov/35123084/)
- [NIDDK: Acid reflux in adults](https://www.niddk.nih.gov/health-information/digestive-diseases/acid-reflux-ger-gerd-adults)

## Related goals

[Improve My Digestion](/goals/improve-digestion) · [Stop Late-Night Snacking](/goals/stop-late-night-snacking) · [Lose Weight](/goals/lose-weight)
