---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1016-j.mhpa.2025.100723
slug: sources/cold-water-immersion/doi-10.1016-j.mhpa.2025.100723
title: 'OUTSIDE: OUTdoor Swimming as a nature-based Intervention for DEpression: a feasibility randomised controlled trial'
summary: Feasibility randomized trial of an eight-session outdoor swimming course plus usual care versus usual care for adults with mild to moderate depression symptoms.
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
  title: 'OUTSIDE: OUTdoor Swimming as a nature-based Intervention for DEpression: a feasibility randomised controlled trial'
  authors: Heather Massey; Hannah Denton; Amy Burlingham; Mara Violato; Anna-Marie Bibby-Jones; Rebecca Cunningham; Sandy Ciccognani; Sam Robertson; Anmol Jhans; Jack Pollard; Shuye Yu; Clara Strauss
  year: 2025
  journal: Mental Health and Physical Activity
  doi: 10.1016/j.mhpa.2025.100723
  url: https://doi.org/10.1016/j.mhpa.2025.100723
  citation: 'Massey H, Denton H, Burlingham A, Violato M, Bibby-Jones AM, Cunningham R, et al. OUTSIDE: OUTdoor Swimming as a nature-based Intervention for DEpression: a feasibility randomised controlled trial. Mental Health and Physical Activity. 2025;29:100723. doi:10.1016/j.mhpa.2025.100723.'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1016/j.mhpa.2025.100723
    titleHash: e3b065e5424468eec59a702d9aea8e4154bce98646e974d35cc83d6092eb7710
    url: https://doi.org/10.1016/j.mhpa.2025.100723
  canonicalUrl: https://doi.org/10.1016/j.mhpa.2025.100723
  identityAliases:
  - doi:10.1016/j.mhpa.2025.100723
  - Heather Massey 2025
  - 'OUTSIDE: OUTdoor Swimming as a nature-based Intervention for DEpression: a feasibility randomised controlled trial'
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Feasibility randomized controlled trial
  populationLabel: Adults with mild to moderate depression symptoms
  durationLabel: 8-week intervention with 8-week follow-up after intervention
  cohortKey: cohort:outside-2025-feasibility-rct
  participantCount: 87
  participantCountKind: reported
  aggregateRole: primary
  notes:
  - 'Intervention/exposure: Eight-session outdoor swimming course plus usual care'
  - 'Comparator/control: Usual care only'
  - 'Endpoints: recruitment; intervention completion; depression; anxiety; wellbeing; mindfulness; self-compassion; quality of life; serious adverse events'
  - 'Effect direction: Feasibility targets were largely met; between-group estimates favored intervention with medium-to-large effects across measures, but efficacy was not definitive.'
  - 'Safety/adverse-event notes: Two serious adverse events occurred and were reported as unrelated to the trial intervention.'
  - 'Limitations: Feasibility trial not powered as a definitive clinical efficacy RCT.; Outdoor swimming includes nature, exercise, group, social prescribing, coaching, and cold-water exposure.; Clinical depression population and supervised sites may not generalize to self-directed cold plunges.'
  - 'Population/directness caveat: Adults with mild-to-moderate depressive symptoms in supervised outdoor swimming programme.'
  - 'Directness to Cold Plunge: clinical_supervised'
  - 'Cold Plunge extraction context: bucket=Mental health, stress, mood, and wellbeing context; directness=clinical_supervised; claimUse=context-only; priority=medium'
sourceFindings:
- findingId: finding:doi-10.1016-j.mhpa.2025.100723:outside-feasibility-rct
  sourceKey: source_artifact:doi-10.1016-j.mhpa.2025.100723
  extractedFromArtifactId: art_doi_10_1016_j_mhpa_2025_100723
  findingKind: intervention_result
  population: Adults with mild to moderate depression symptoms
  exposure: Outdoor swimming course plus usual care compared with usual care only
  outcome: Feasibility, depression, anxiety, wellbeing, mindfulness, self-compassion, quality of life
  summary: Feasibility RCT recruited 87 participants; 79% of the outdoor swimming arm completed at least 4 of 8 sessions. Between-group differences favored the intervention arm across measures with medium-to-large effect estimates, but the trial was designed for feasibility rather than definitive efficacy.
  evidenceUse:
  - adjacent_variant
  - context
  - efficacy
- findingId: finding:doi-10.1016-j.mhpa.2025.100723:outside-safety
  sourceKey: source_artifact:doi-10.1016-j.mhpa.2025.100723
  extractedFromArtifactId: art_doi_10_1016_j_mhpa_2025_100723
  findingKind: safety
  population: Adults with mild to moderate depression symptoms in a supervised outdoor swimming RCT
  exposure: Outdoor swimming course plus usual care
  outcome: Serious adverse events
  summary: Two serious adverse events occurred during the feasibility RCT and were reported as unrelated to the trial intervention in extracted materials.
  evidenceUse:
  - safety
  - context
coldPlungeExtraction:
  batchId: batch-006
  evidenceBucket: Mental health, stress, mood, and wellbeing context
  directness: clinical_supervised
  claimUse: context-only
  priority: medium
  artifactRightsStatusGuess: open_access
  identityResolutionStatus: new_source
aliases:
- doi:10.1016/j.mhpa.2025.100723
- Heather Massey 2025
- 'OUTSIDE: OUTdoor Swimming as a nature-based Intervention for DEpression: a feasibility randomised controlled trial'
- 10.1016/j.mhpa.2025.100723
---

This source is included for **Mental health, stress, mood, and wellbeing context**.

**Findings:** Feasibility RCT recruited 87 participants; 79% of the outdoor swimming arm completed at least 4 of 8 sessions. Between-group differences favored the intervention arm across measures with medium-to-large effect estimates, but the trial was designed for feasibility rather than definitive efficacy. Two serious adverse events occurred during the feasibility RCT and were reported as unrelated to the trial intervention in extracted materials.

**Why it matters:** The strongest clinical-supervised adjacent trial in this batch, useful for depression/anxiety endpoint selection and feasibility/safety framing.

**Potential experiment signals:** PHQ-9 depression symptoms, GAD-7 anxiety symptoms, wellbeing, quality of life, serious adverse events.

**Protocol takeaway:** Promising supervised outdoor swimming trial context, but still not isolated cold-plunge efficacy evidence.

**Claim use:** `context-only`.
