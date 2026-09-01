---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:get-sleep-apnea-under-control
slug: get-sleep-apnea-under-control
title: Get Sleep Apnea Under Control
summary: Confirm the diagnosis, choose an effective treatment, and follow symptoms and treatment data until breathing is reliably controlled.
status: field-testing
quality: usable
aliases:
  - manage my sleep apnea
  - treat obstructive sleep apnea
categories:
  - goals
  - sleep
  - sleep-apnea
  - breathing
goal:
  category: sleep
  outcomeKind: symptom
  goalPhrase: get my sleep apnea under control
  successSignals:
    - id: effective_apnea_treatment
      kind: behavior
      label: Effective treatment used as prescribed
    - id: improved_breathing_control
      kind: symptom
      label: Breathing events controlled on clinical or device review
    - id: improved_daytime_function
      kind: function
      label: Better sleep-related daytime function
  evidenceSourceKeys:
    - source_artifact:pmid-19960649
    - source_artifact:pmid-30736887
  workflow:
    kind: care_support
    ownerSkillIds:
      - sleep-improvement
      - sleep-recovery-readiness
  startPrompt: Hey Murph, help me get my sleep apnea under control.
  indexable: true
safety:
  cautionLevel: high
---

Obstructive sleep apnea makes the upper airway narrow or close repeatedly during sleep. Controlling it means using a treatment that keeps the airway open, checking that it works, and improving symptoms and long-term health risk, not just quieting snoring. Diagnosis and treatment belong with a qualified clinician, but daily follow-through delivers much of the benefit.

## What to do

- Confirm the diagnosis with an appropriate home sleep apnea test or laboratory sleep study. A smartwatch alert or snoring app can prompt the conversation, not make the diagnosis.
- Go over severity, symptoms, anatomy, sleep position, other conditions, and your preferences with a sleep clinician.
- Use the prescribed treatment consistently. Positive airway pressure (PAP) is a common first-line option; fitted oral appliances, positional therapy, weight management, surgery, or other approaches may suit selected cases.
- Fix comfort problems early; mask leak, pressure discomfort, dry mouth, congestion, skin irritation, and swallowed air usually have specific fixes.
- Limit alcohol near bedtime, and ask the prescriber to review sedating medicines that may worsen breathing.
- Treat relevant nasal obstruction, stay active, and follow a body-weight plan you can keep up where that applies.

## A simple plan

Start with a clear baseline: diagnosis date, apnea-hypopnea index (AHI, the average number of breathing events per hour) from the study, oxygen findings, main symptoms, blood pressure if relevant, and the treatment recommendation. Put the next appointment or equipment step on the calendar.

For the first month, review progress weekly. If you use PAP, note nights used, rough hours, leak or mask problems, and whether daytime sleepiness or morning headaches are easing. Don't chase a perfect machine score; use it to find a barrier you can fix.

Bring the machine or app report and a short symptom summary to follow-up. Ask whether remaining breathing events, pauses that appear during treatment, mask leak, or pressure settings need adjusting. If the first treatment is intolerable, discuss alternatives rather than quietly dropping care.

## How to know it is working

Effective control combines objective and lived outcomes: treatment used through most of the sleep period, remaining breathing events acceptably controlled for your situation, oxygen no longer dropping repeatedly, and improvement in gasping, morning headaches, waking to urinate, or daytime sleepiness.

Not everyone feels dramatically different, especially if sleepiness was never prominent, but treatment still has value. Nor does feeling better prove the breathing events are controlled; use follow-up data and symptoms together.

## If you get stuck

For PAP problems, name the exact barrier. Leak may need a different mask size or style, dryness may need heated humidification, and nasal congestion needs its own treatment. Pressure intolerance may improve with a gentler start-up pressure, easier exhalation, or a clinical settings review. Don't change prescribed pressure ranges without the treating team.

For oral appliances, use one provided and monitored by a qualified dentist, and confirm it works with follow-up sleep testing. After meaningful weight change, repeat testing may be needed; don't assume the apnea is gone. Positional devices help only when events are truly position dependent.

If sleepiness persists despite well-controlled apnea, look for short sleep, insomnia, restless legs, medication effects, depression, or another sleep disorder.

## A quick note

Untreated apnea plus dangerous sleepiness can make driving unsafe. Get prompt medical review for severe sleepiness, chest symptoms, or breathing concerns that arise during treatment. Don't stop PAP around surgery or a hospital stay without telling the care team.

## Sources

- [2025 VA/DoD guideline for chronic insomnia and obstructive sleep apnea](https://www.healthquality.va.gov/guidelines/CD/insomnia/index.asp)
- [AASM guideline for positive airway pressure treatment](https://jcsm.aasm.org/doi/10.5664/jcsm.7640)
- [NHLBI: sleep apnea treatment](https://www.nhlbi.nih.gov/health/sleep-apnea/treatment)
