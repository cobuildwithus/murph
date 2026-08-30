---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:reduce-acid-reflux
slug: reduce-acid-reflux
title: Reduce Acid Reflux
summary: Reduce heartburn and regurgitation with meal timing, individual trigger management, and appropriate treatment.
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

Acid reflux commonly causes heartburn or regurgitation when stomach contents move into the esophagus. Occasional symptoms may respond to meal and position changes; frequent symptoms can represent gastroesophageal reflux disease and may need medication or testing. The practical goal is to reduce the patterns that matter to you without banning a generic list of foods you tolerate well.

## What to do

Focus on the measures with the clearest practical value:

- Leave about three hours between the last substantial meal and lying down when nighttime symptoms are a problem.
- Reduce very large meals, especially late in the day.
- Identify personal triggers rather than automatically removing coffee, tomatoes, citrus, chocolate, mint, spicy food, and every high-fat food.
- If higher body weight contributes and weight loss is appropriate, gradual loss can improve symptoms.
- Stop smoking and reduce alcohol if either worsens reflux.
- For nighttime reflux, elevate the head of the bed with a wedge or bed risers rather than stacking ordinary pillows.
- Use acid-suppressing medicine correctly when prescribed; timing matters for proton-pump inhibitors.

Avoid bending, heavy straining, or vigorous exercise immediately after a large meal if that predictably provokes symptoms.

## A simple plan

Track symptoms for one week: meal timing and size, bedtime, body position, alcohol, and the main suspected trigger. Choose the strongest pattern.

If symptoms occur at night, move dinner earlier or make it smaller for two weeks and elevate the head of the bed. If one food is strongly suspected, remove only that food for a defined period, then reintroduce it. If symptoms happen more than occasionally, ask a clinician or pharmacist whether an evidence-based medication trial is appropriate and how to take it.

Review after two to four weeks. Keep changes that clearly help and restore foods that do not.

## How to know it is working

Track symptom days per week, nighttime awakenings, rescue-antacid use, regurgitation, and interference with meals or activity. A reduction in symptoms and medication burden under clinician guidance is more useful than trying to change stomach acidity with consumer tests.

## What to expect

Meal timing and positioning can help within days. Acid-suppressing medicines may take several days for full effect. Some people have reflux hypersensitivity or other conditions that mimic reflux, so persistent symptoms despite appropriate treatment do not justify endless food restriction.

## If you get stuck

Confirm medication timing and adherence with a clinician. Review constipation, large late meals, alcohol, smoking, and weight change. If symptoms are primarily throat clearing, cough, or hoarseness without typical heartburn, other causes should be considered. Persistent symptoms may require endoscopy or reflux monitoring depending on age, history, and alarm features.

## A quick note

Chest pressure with exertion, sweating, shortness of breath, pain spreading to the arm or jaw, or a new severe episode needs urgent evaluation. Difficulty swallowing, food sticking, bleeding, anemia, persistent vomiting, or weight loss also requires medical care. Do not stop a prescribed proton-pump inhibitor abruptly without discussing the plan.

## Sources

- [American College of Gastroenterology: GERD guideline](https://pubmed.ncbi.nlm.nih.gov/34807007/)
- [AGA: Personalized evaluation and management of GERD](https://pubmed.ncbi.nlm.nih.gov/35123084/)
- [NIDDK: Acid reflux in adults](https://www.niddk.nih.gov/health-information/digestive-diseases/acid-reflux-ger-gerd-adults)

## Related goals

[Improve My Digestion](/goals/improve-digestion) · [Stop Late-Night Snacking](/goals/stop-late-night-snacking) · [Lose Weight](/goals/lose-weight)
