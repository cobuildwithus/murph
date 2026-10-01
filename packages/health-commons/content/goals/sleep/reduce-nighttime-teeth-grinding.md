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

Sleep bruxism is grinding, clenching, or other jaw activity during sleep. Mild cases often need no treatment, but frequent grinding can wear or crack teeth and cause jaw pain and morning headaches. The plan protects the teeth, reduces contributors, and checks for related sleep problems.

## What to do

- Get a dental exam if you have pain, tooth sensitivity, visible wear, cracked restorations, or a partner hears regular grinding.
- Ask whether a fitted night guard makes sense. It protects teeth but won't necessarily stop the muscle activity underneath.
- Review stress, anxiety, caffeine, alcohol, nicotine, and sleep loss. All can be linked with bruxism, but no single trigger explains every case.
- Review medicines with the prescriber. Some antidepressants and other drugs can contribute in susceptible people.
- Watch for snoring, gasping, dry mouth, and daytime sleepiness; sleep bruxism can coexist with obstructive sleep apnea.
- During the day, keep a relaxed jaw, with lips together, teeth apart, and tongue resting comfortably, to cut total jaw load.

## A simple plan

For two weeks, rate morning jaw pain or headache from 0 to 10, note partner-reported grinding, and record only major exposures: late caffeine, alcohol, a very stressful day, or a medication change. Don't record yourself all night.

If symptoms are more than occasional, book a dental visit. Bring the timeline and ask the dentist to check for tooth wear, damaged restorations, tender jaw muscles, and signs that point to a sleep evaluation. If you get a guard, follow the fitting and cleaning instructions and report new jaw pain or bite changes.

Add a short daytime downshift: several times a day, release the tongue and jaw, drop the shoulders, and take five slow breaths. It helps daytime clenching and stress more than sleep bruxism itself, but it's cheap to test. Skip long gum chewing when the jaw is sore.

## How to know it is working

Watch for less morning pain, fewer headaches, no new tooth damage, and less partner-reported grinding. A worn guard shows it's protecting your teeth, not whether the problem is improving.

Phone audio can pick up grinding but may confuse it with movement, snoring, or room noise. Not every case needs a sleep study, but one helps when the diagnosis is unclear or apnea is suspected.

## If you get stuck

Don't keep buying harder guards as symptoms worsen. An ill-fitting over-the-counter guard can change comfort and may not suit dental work, jaw disorders, or suspected apnea. See the dentist for fit and diagnosis.

If pain persists, a clinician or physical therapist experienced in temporomandibular disorders can address jaw-muscle and neck contributors. If symptoms began after a medicine change, ask the prescriber about options. If you snore or gasp, get the airway checked rather than blaming stress alone.

## A quick note

Get prompt dental care for a cracked tooth, severe tooth pain, facial swelling, or a jaw you can't open normally. Do not stop a psychiatric medicine abruptly because you suspect it contributes.

## Sources

- [National Institute of Dental and Craniofacial Research: bruxism](https://www.nidcr.nih.gov/health-info/bruxism)
- [NIDCR expert guidance on tooth grinding](https://www.nidcr.nih.gov/health-info/bruxism/ask-expert-bruxism-tooth-grinding)
