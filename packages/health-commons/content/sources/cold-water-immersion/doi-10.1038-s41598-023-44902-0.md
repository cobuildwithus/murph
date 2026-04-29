---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1038-s41598-023-44902-0
slug: sources/cold-water-immersion/doi-10.1038-s41598-023-44902-0
title: The effectiveness of the Wim Hof method on cardiac autonomic function, blood pressure, arterial compliance, and different psychological parameters
summary: Randomized controlled trial of a 15-day Wim Hof Method protocol combining cold showers, breathing, and meditation; no significant psychological or cardiovascular advantages were detected.
status: draft
quality: usable
categories:
- cold-water-immersion
- cold-plunge
relations:
- type: parent_family
  target: experiment_family:cold-water-immersion
- type: related_protocol
  target: protocol_variant:cold-water-immersion/cold-plunge
source:
  kind: journal_article
  title: The effectiveness of the Wim Hof method on cardiac autonomic function, blood pressure, arterial compliance, and different psychological parameters
  authors: Sascha Ketelhut; Dario Querciagrossa; Xavier Bisang; Xavier Metry; Eric Borter; Claudio R. Nigg
  year: 2023
  journal: Scientific Reports
  doi: 10.1038/s41598-023-44902-0
  url: https://doi.org/10.1038/s41598-023-44902-0
  citation: Ketelhut S, Querciagrossa D, Bisang X, Metry X, Borter E, Nigg CR. The effectiveness of the Wim Hof method on cardiac autonomic function, blood pressure, arterial compliance, and different psychological parameters. Scientific Reports. 2023;13:17517. doi:10.1038/s41598-023-44902-0.
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1038/s41598-023-44902-0
    titleHash: e963f3147321ff7991fb0363dcd7ccb6aefe8e8f1bded543226348251bca91d9
    url: https://doi.org/10.1038/s41598-023-44902-0
  canonicalUrl: https://doi.org/10.1038/s41598-023-44902-0
  identityAliases:
  - doi:10.1038/s41598-023-44902-0
  - Sascha Ketelhut 2023
  - The effectiveness of the Wim Hof method on cardiac autonomic function, blood pressure, arterial compliance, and different psychological parameters
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Parallel-arm randomized controlled trial
  populationLabel: Screened healthy young adult men
  durationLabel: 15 days
  cohortKey: cohort:ketelhut-2023-whm-rct
  participantCount: 42
  participantCountKind: reported
  aggregateRole: primary
  notes:
  - 'Intervention/exposure: 15-day Wim Hof Method protocol: cold showers, breathing exercises, meditation'
  - 'Comparator/control: No-intervention usual activity control'
  - 'Endpoints: heart rate; HRV RMSSD; HRV SDNN; blood pressure; pulse wave velocity; PANAS affect; perceived stress; subjective vitality; cold pressor response'
  - 'Effect direction: No significant time-by-group interactions for cardiovascular or psychological endpoints were detected.'
  - 'Safety/adverse-event notes: One intervention participant dropped out due to illness; no adverse events occurred during the intervention period.'
  - 'Limitations: Cold exposure was cold showers, not plunge immersion.; WHM bundled breathing and meditation with cold exposure.; Male-only screened healthy sample; small final sample.; Short 15-day intervention.'
  - 'Population/directness caveat: Healthy young male WHM participants, not general adult cold-plunge users.'
  - 'Directness to Cold Plunge: adjacent_variant'
  - 'Cold Plunge extraction context: bucket=Mental health, stress, mood, and wellbeing context; directness=adjacent_variant; claimUse=context-only; priority=medium'
sourceFindings:
- findingId: finding:doi-10.1038-s41598-023-44902-0:whm-null-psychological
  sourceKey: source_artifact:doi-10.1038-s41598-023-44902-0
  extractedFromArtifactId: art_doi_10_1038_s41598_023_44902_0
  findingKind: intervention_result
  population: Healthy young adult men without prior WHM component experience
  exposure: 15-day Wim Hof Method intervention with breathing, meditation, and cold showers
  outcome: Cardiac autonomic function, blood pressure, arterial compliance, perceived stress, affect, vitality
  summary: In an RCT with 42 randomized participants, daily WHM did not produce significant time-by-group effects for HR, HRV metrics, blood pressure, pulse wave velocity, PANAS positive/negative affect, subjective vitality, or perceived stress. One intervention participant dropped out due to illness and final analysis included 21 intervention and 20 control participants.
  evidenceUse:
  - adjacent_variant
  - context
  - efficacy
- findingId: finding:doi-10.1038-s41598-023-44902-0:whm-no-adverse-events-screened
  sourceKey: source_artifact:doi-10.1038-s41598-023-44902-0
  extractedFromArtifactId: art_doi_10_1038_s41598_023_44902_0
  findingKind: safety
  population: Screened healthy young adult male participants
  exposure: 15-day WHM cold-shower, breathing, and meditation protocol
  outcome: Adverse events
  summary: No adverse events occurred during the intervention period in the extracted report, but the study was small, male-only, and screened for health conditions.
  evidenceUse:
  - safety
  - context
coldPlungeExtraction:
  batchId: batch-006
  evidenceBucket: Mental health, stress, mood, and wellbeing context
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  artifactRightsStatusGuess: open_access
  identityResolutionStatus: new_source
aliases:
- doi:10.1038/s41598-023-44902-0
- Sascha Ketelhut 2023
- The effectiveness of the Wim Hof method on cardiac autonomic function, blood pressure, arterial compliance, and different psychological parameters
- 10.1038/s41598-023-44902-0
---

This source is included for **Mental health, stress, mood, and wellbeing context**.

**Findings:** In an RCT with 42 randomized participants, daily WHM did not produce significant time-by-group effects for HR, HRV metrics, blood pressure, pulse wave velocity, PANAS positive/negative affect, subjective vitality, or perceived stress. One intervention participant dropped out due to illness and final analysis included 21 intervention and 20 control participants. No adverse events occurred during the intervention period in the extracted report, but the study was small, male-only, and screened for health conditions.

**Why it matters:** Important null/mixed boundary source for WHM-style claims and for avoiding overstatement of cold-shower/breathwork stacks.

**Potential experiment signals:** perceived stress, positive affect, negative affect, subjective vitality, HRV RMSSD, blood pressure.

**Protocol takeaway:** Do not use WHM-bundled cold-shower data to support cold-plunge efficacy; preserve the null psychological findings.

**Claim use:** `context-only`.
