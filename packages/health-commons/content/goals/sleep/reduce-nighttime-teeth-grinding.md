---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:reduce-nighttime-teeth-grinding
slug: reduce-nighttime-teeth-grinding
title: Reduce Nighttime Teeth Grinding
summary: Protect teeth and reduce jaw symptoms while addressing stress, medicines, and sleep problems linked with nighttime grinding.
status: field-testing
quality: usable
aliases:
  - stop grinding my teeth at night
  - reduce sleep bruxism
categories:
  - goals
  - sleep
  - bruxism
  - dental-health
goal:
  category: sleep
  outcomeKind: symptom
  goalPhrase: reduce nighttime teeth grinding
  successSignals:
    - id: lower_jaw_symptoms
      kind: symptom
      label: Less morning jaw pain or headache
    - id: protected_teeth
      kind: function
      label: No new tooth damage from grinding
    - id: lower_partner_report
      kind: symptom
      label: Less partner-reported grinding when observable
  evidenceSourceKeys:
    - source_artifact:pmid-38769624
    - source_artifact:pmid-19960649
  workflow:
    kind: care_support
    ownerSkillIds:
      - sleep-improvement
      - stress-regulation
  startPrompt: Hey Murph, help me reduce nighttime teeth grinding.
  indexable: true
safety:
  cautionLevel: moderate
---

Sleep bruxism is grinding, clenching, or jaw activity during sleep. Many mild cases do not need treatment, but frequent bruxism can contribute to tooth wear, cracked teeth, jaw pain, and morning headaches. Because you cannot simply remind yourself to stop while asleep, the plan focuses on protecting the teeth, reducing contributors, and checking for related sleep problems.

## What to do

- Get a dental exam if you have pain, tooth sensitivity, visible wear, cracked restorations, or a partner hears regular grinding.
- Ask whether a fitted night guard is appropriate. A guard mainly protects teeth; it does not necessarily eliminate the underlying muscle activity.
- Review stress, anxiety, caffeine, alcohol, nicotine, and sleep loss. These can be associated with bruxism, although no single trigger explains every case.
- Review medicines with the prescriber. Some antidepressants and other drugs can contribute in susceptible people.
- Pay attention to snoring, gasping, dry mouth, and daytime sleepiness. Sleep bruxism can coexist with obstructive sleep apnea.
- During the day, practice a relaxed jaw position: lips together, teeth apart, and tongue resting comfortably. Reducing daytime clenching can ease the total jaw load.

## A simple plan

For two weeks, rate morning jaw pain or headache from 0 to 10, note partner-reported grinding, and record only major exposures such as late caffeine, alcohol, a highly stressful day, or a medication change. Avoid repeatedly recording yourself all night.

Book a dental visit if symptoms are more than occasional. Bring the timeline and ask the dentist to look for tooth wear, restoration damage, jaw-muscle tenderness, and signs that suggest a sleep evaluation. If a guard is provided, follow fitting and cleaning instructions and report new jaw pain or bite changes.

Add a short daytime downshift: several times per day, release the tongue and jaw, lower the shoulders, and take five slow breaths. This is more likely to help daytime clenching and stress load than to guarantee the end of sleep bruxism, but it is low burden and testable. Avoid chewing gum for long periods when the jaw is already sore.

## How to know it is working

The most useful outcomes are less morning pain, fewer headaches, no new tooth damage, and less frequent partner-reported grinding. A worn mouth guard shows that it is protecting the teeth; it does not prove the problem is getting worse or better without clinical context.

Phone audio can capture some grinding sounds but may confuse them with movement, snoring, or environmental noise. A formal sleep study is not needed for every case, but it can help when the diagnosis is uncertain or sleep apnea is suspected.

## If you get stuck

Do not keep buying harder guards when symptoms worsen. An ill-fitting over-the-counter guard can change comfort and may be unsuitable with dental work, jaw disorders, or suspected apnea. Return to the dentist for fit and diagnosis.

If pain persists, a clinician or physical therapist experienced in temporomandibular disorders can address jaw-muscle and neck contributors. If symptoms began after a medicine change, discuss options with the prescriber. If snoring or gasping is present, evaluate the airway rather than assuming grinding is only stress.

## A quick note

Seek prompt dental care for a cracked tooth, severe tooth pain, facial swelling, or inability to open the jaw normally. Do not stop a psychiatric medicine abruptly because you suspect it contributes.

## Sources

- [National Institute of Dental and Craniofacial Research: bruxism](https://www.nidcr.nih.gov/health-info/bruxism)
- [NIDCR expert guidance on tooth grinding](https://www.nidcr.nih.gov/health-info/bruxism/ask-expert-bruxism-tooth-grinding)
