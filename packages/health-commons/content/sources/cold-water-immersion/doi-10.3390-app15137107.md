---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.3390-app15137107
slug: sources/cold-water-immersion/doi-10.3390-app15137107
title: Hormonal and Psychological Responses to a Single Cold-Water Immersion in Regularly Winter-Swimming Males
summary: Acute single-CWI study comparing regular winter-swimming men with non-cold-exposed controls, focused on hormones and psychological responses.
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
  title: Hormonal and Psychological Responses to a Single Cold-Water Immersion in Regularly Winter-Swimming Males
  authors: Aneta Teległów; Krzysztof Wrześniewski; Jan Blecharz
  year: 2025
  journal: Applied Sciences
  doi: 10.3390/app15137107
  url: https://doi.org/10.3390/app15137107
  citation: Teległów A, Wrześniewski K, Blecharz J. Hormonal and Psychological Responses to a Single Cold-Water Immersion in Regularly Winter-Swimming Males. Applied Sciences. 2025;15(13):7107. doi:10.3390/app15137107.
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.3390/app15137107
    titleHash: f504b92fe7dd7309eed6802cf2627262b8c8f14df4544ea93e656d930f3c5dc8
    url: https://doi.org/10.3390/app15137107
  canonicalUrl: https://doi.org/10.3390/app15137107
  identityAliases:
  - doi:10.3390/app15137107
  - Aneta Teległów 2025
  - Hormonal and Psychological Responses to a Single Cold-Water Immersion in Regularly Winter-Swimming Males
researchEvidence:
  designKind: acute_mechanistic
  designLabel: Acute cohort/comparison study in habituated winter swimmers
  populationLabel: Males aged 30-50; regular winter swimmers and controls
  durationLabel: Single acute immersion with 24-hour pre/post measurements
  cohortKey: cohort:teleglow-2025-winter-swimmer-hormones
  participantCount: 30
  participantCountKind: reported
  aggregateRole: primary
  notes:
  - 'Intervention/exposure: Single cold-water immersion at about 4 °C among winter swimmers; repeated measures 24h before, immediately after, and 24h after'
  - 'Comparator/control: Male controls with no cold-water contact'
  - 'Endpoints: emotional states; life satisfaction; noradrenaline; adrenaline; cortisol; serotonin; dopamine'
  - 'Effect direction: Hormonal changes were reported in habituated winter swimmers; findings are mechanistic/adjacent and not direct efficacy evidence.'
  - 'Safety/adverse-event notes: No specific adverse-event extraction found in the batch material.'
  - 'Limitations: Small male-only sample.; Habitual winter swimmers, not cold-naive participants.; Control group did not receive the same immersion exposure in the extracted summary.; Mechanistic hormones do not establish wellbeing benefit.'
  - 'Population/directness caveat: Regular winter-swimming males differ from general, mixed-sex, novice cold-plunge users.'
  - 'Directness to Cold Plunge: adjacent_variant'
  - 'Cold Plunge extraction context: bucket=Mental health, stress, mood, and wellbeing context; directness=adjacent_variant; claimUse=context-only; priority=medium'
sourceFindings:
- findingId: finding:doi-10.3390-app15137107:winter-swimmer-hormones
  sourceKey: source_artifact:doi-10.3390-app15137107
  extractedFromArtifactId: art_doi_10_3390_app15137107
  findingKind: mechanistic
  population: Regular winter-swimming males aged 30-50 and non-cold-exposed male controls
  exposure: Single 4 °C cold-water immersion in habitual winter swimmers; comparison with controls without cold-water contact
  outcome: Subjective emotional states, life satisfaction, and hormone concentrations
  summary: Study involved 30 males, 15 regular winter swimmers and 15 controls. Winter swimmers had higher adrenaline than controls; 24 hours after CWI the winter-swimming group showed reduced noradrenaline and adrenaline concentrations and a slight cortisol increase compared with controls; dopamine remained unchanged. This is a habituated male physiology/psychology context, not novice cold-plunge efficacy evidence.
  evidenceUse:
  - adjacent_variant
  - mechanism
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
- doi:10.3390/app15137107
- Aneta Teległów 2025
- Hormonal and Psychological Responses to a Single Cold-Water Immersion in Regularly Winter-Swimming Males
- 10.3390/app15137107
---

This source is included for **Mental health, stress, mood, and wellbeing context**.

**Findings:** Study involved 30 males, 15 regular winter swimmers and 15 controls. Winter swimmers had higher adrenaline than controls; 24 hours after CWI the winter-swimming group showed reduced noradrenaline and adrenaline concentrations and a slight cortisol increase compared with controls; dopamine remained unchanged. This is a habituated male physiology/psychology context, not novice cold-plunge efficacy evidence.

**Why it matters:** Useful as habituation/mechanistic context for hormone and mood measurement boundaries.

**Potential experiment signals:** adrenaline, noradrenaline, cortisol, emotional state, life satisfaction.

**Protocol takeaway:** Use only as habituated winter-swimmer mechanism/context; do not generalize to novice cold-plunge benefits.

**Claim use:** `context-only`.
