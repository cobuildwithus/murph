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

Using CPAP consistently means removing barriers, not toughing it out. If the mask leaks, the nose blocks, the pressure overwhelms, or the gear is awkward, fix that. Use it every time you sleep, naps included, and gradually extend it through the whole sleep period.

## What to do

- Pin down the one reason you remove or skip it: leak, claustrophobia, pressure, dryness, congestion, skin irritation, noise, aerophagia, or travel hassle.
- Check mask fit lying in your normal sleep position with the machine running; a mask can fit sitting up and leak on the pillow.
- Clean and replace parts on the manufacturer's and clinician's schedule. Worn cushions and dirty filters cause avoidable problems.
- Use heated humidification or heated tubing for dryness or rainout, set for comfort.
- Treat nasal congestion properly: saline, allergy treatment, or a different mask style may help. Ask before relying on decongestant sprays.
- Practice while awake if the sensation makes you anxious. Ten calm minutes reading or watching TV makes bedtime less abrupt.

## A simple plan

For the first week, put the mask on before you're exhausted and use it for every sleep attempt. If you remove it in your sleep, put it back on when you notice; the night isn't ruined. Record only the barrier and the next fix.

After several nights, review the machine report: usage hours, leak, residual events. One night of high leak can be position or equipment; repeated high leak needs a fit review. If pressure discomfort keeps causing removal, contact the sleep team rather than changing clinical settings yourself.

Build a two-minute setup: water filled if used, mask connected, supplies in one place. For travel, keep a checklist: machine, mask, hose, power supply, adapter, prescription documentation, backup options.

## How to know it is working

First, use gets more complete: more nights, more hours, fewer unconscious removals. Second, the data shows acceptable leak and residual breathing control. Third, symptoms you had before treatment, such as gasping, morning headache, dry mouth, nocturia, or sleepiness, improve.

Insurance compliance thresholds are administrative minimums, not the biological goal. Apnea returns whenever the machine is off, so use through the full sleep period gives the most consistent protection.

## If you get stuck

Leak may improve with a different cushion size, nasal versus full-face style, pillow, or hose routing. Dry mouth with a nasal mask may mean mouth leak; a chin strap isn't always the answer. Aerophagia, central events, or persistently high residual events need clinical review.

For claustrophobia, build up in steps: hold the mask to your face without straps, add straps, connect low airflow, then lie down. Stop before panic peaks and repeat while calm. A behavioral sleep specialist can help if anxiety stays strong.

If CPAP is still intolerable after real troubleshooting, ask about other evidence-based treatments. It is not “CPAP or nothing.”

## A quick note

Contact the care team for new chest pain, severe shortness of breath, major pressure intolerance, skin breakdown, or treatment data showing persistent problems. Keep PAP with you during hospital stays and tell surgical teams about your sleep apnea.

## Sources

- [AASM guideline for positive airway pressure treatment](https://jcsm.aasm.org/doi/10.5664/jcsm.7640)
- [NHLBI: CPAP and other sleep apnea treatments](https://www.nhlbi.nih.gov/health/sleep-apnea/treatment)
