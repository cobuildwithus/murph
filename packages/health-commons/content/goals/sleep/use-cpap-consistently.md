---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:use-cpap-consistently
slug: use-cpap-consistently
title: Use CPAP Consistently
summary: Make positive-airway-pressure treatment comfortable and reliable enough to use through the whole sleep period.
status: field-testing
quality: usable
aliases:
  - wear my CPAP every night
  - improve CPAP adherence
categories:
  - goals
  - sleep
  - sleep-apnea
  - cpap
goal:
  category: sleep
  parentGoalKey: goal_template:get-sleep-apnea-under-control
  outcomeKind: behavior
  goalPhrase: use my CPAP consistently
  successSignals:
    - id: nights_with_pap
      kind: behavior
      label: PAP used every time sleep occurs
    - id: full_sleep_period_use
      kind: behavior
      label: PAP used through most of the sleep period
    - id: lower_treatment_burden
      kind: symptom
      label: Less discomfort or disruption from treatment
  evidenceSourceKeys:
    - source_artifact:pmid-30736887
    - source_artifact:pmid-19960649
  workflow:
    kind: habit_plan
    ownerSkillIds:
      - sleep-improvement
      - behavior-followthrough
  startPrompt: Hey Murph, help me use my CPAP consistently.
  indexable: true
safety:
  cautionLevel: moderate
---

Consistent CPAP use is not a test of toughness. If the mask leaks, the nose blocks, pressure feels overwhelming, or the equipment is awkward, the right move is to fix that barrier. The practical target is to use positive airway pressure every time you sleep—including naps—and gradually extend it through the entire sleep period.

## What to do

- Identify the single reason you remove or skip it: mask leak, claustrophobia, pressure, dryness, congestion, skin irritation, noise, aerophagia, or travel friction.
- Check mask fit while lying in your normal sleep position with the machine running. A mask can fit while sitting and leak on the pillow.
- Clean and replace equipment on the manufacturer's and clinician's schedule. Worn cushions and dirty filters can create avoidable problems.
- Use heated humidification or heated tubing when dryness or rainout is an issue, with settings adjusted to comfort.
- Treat nasal congestion appropriately. Saline, allergy treatment, or a different mask style may help; ask before relying on decongestant sprays.
- Practice while awake if the sensation causes anxiety. Ten calm minutes while reading or watching television can make bedtime exposure less abrupt.

## A simple plan

For the first week, put the mask on before you become extremely tired and use it for every sleep attempt. If you remove it unknowingly, place it back on when you notice without treating the night as ruined. Record only the barrier and the next fix.

Review the machine report after several nights: usage hours, mask leak, and residual events. Focus on patterns. One night of high leak can be position or equipment; repeated high leak needs a fit review. If pressure discomfort repeatedly causes removal, contact the sleep team rather than changing clinical settings on your own.

Create a two-minute setup: water filled if used, mask connected, and supplies in one location. For travel, keep a checklist for machine, mask, hose, power supply, adapter, prescription documentation, and backup options.

## How to know it is working

First, use becomes more complete: more nights, more hours, and fewer unconscious removals. Second, treatment data shows acceptable leak and residual breathing control. Third, relevant symptoms—gasping, morning headache, dry mouth, nocturia, or sleepiness—improve when they were present before treatment.

Insurance compliance thresholds are administrative minimums, not the biological goal. Sleep apnea returns whenever the machine is off, so use through the full sleep period offers the most consistent protection.

## If you get stuck

Mask leak may improve with a different cushion size, nasal versus full-face style, pillow, or hose routing. Dry mouth with a nasal mask may signal mouth leak; do not assume a chin strap is always the answer. Aerophagia, central events, or persistently high residual events require clinical review.

For claustrophobia, practice in small steps: hold the mask to the face without straps, add straps, connect low airflow, then lie down. Stop before panic peaks and repeat while calm. A behavioral sleep specialist can help when anxiety remains strong.

If CPAP remains intolerable after genuine troubleshooting, ask about other evidence-based treatments. The choice is not “CPAP or nothing.”

## A quick note

Contact the care team for new chest pain, severe shortness of breath, major pressure intolerance, skin breakdown, or treatment data that shows persistent problems. Keep PAP available during hospital stays and tell surgical teams about sleep apnea.

## Sources

- [AASM guideline for positive airway pressure treatment](https://jcsm.aasm.org/doi/10.5664/jcsm.7640)
- [NHLBI: CPAP and other sleep apnea treatments](https://www.nhlbi.nih.gov/health/sleep-apnea/treatment)
