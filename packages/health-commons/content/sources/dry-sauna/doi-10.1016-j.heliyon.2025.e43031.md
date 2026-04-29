---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1016-j.heliyon.2025.e43031
slug: sources/dry-sauna/doi-10.1016-j.heliyon.2025.e43031
title: Clinical characteristics of severe patients transferred from sauna facilities
summary: Single-center retrospective cohort of severe sauna-facility transfers, emphasizing older male patients, underlying conditions, alcohol exposure, cardiac arrest, head trauma, heat stroke, and deaths.
status: draft
quality: usable
aliases:
  - Kawahara 2025 severe sauna facility transfers
  - Heliyon e43031 sauna emergency patients
categories:
  - dry-sauna
relations:

  -
    type: related_protocol
    target: protocol_variant:dry-sauna/bryan-johnson-blueprint

  -
    type: parent_family
    target: experiment_family:dry-sauna
source:
  kind: journal_article
  title: Clinical characteristics of severe patients transferred from sauna facilities
  authors: Naoki Kawahara; Hiroki Matsui; Koji Morishita
  year: 2025
  journal: Heliyon
  citation: Kawahara N, Matsui H, Morishita K. Clinical characteristics of severe patients transferred from sauna facilities. Heliyon. 2025;11(6):e43031. doi:10.1016/j.heliyon.2025.e43031.
  doi: 10.1016/j.heliyon.2025.e43031
  url: https://www.sciencedirect.com/science/article/pii/S2405844025014124
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1016/j.heliyon.2025.e43031
    url: https://www.sciencedirect.com/science/article/pii/S2405844025014124
  canonicalUrl: https://www.sciencedirect.com/science/article/pii/S2405844025014124
researchEvidence:
  designKind: prospective_cohort
  designLabel: Single-center retrospective observational study of severe sauna-facility transfers
  participantCount: 25
  participantCountKind: reported
  populationLabel: Patients transported from sauna facilities to Tokyo Medical and Dental University Hospital who required hospitalization or died in the emergency room.
  durationLabel: January 1, 2015 to March 31, 2024 case ascertainment.
  aggregateRole: primary
  cohortKey: kawahara-2025-severe-sauna-facility-transfers
  notes:
    - interventionOrExposure: Severe illness or injury associated with use of sauna facilities.
    - comparatorOrControl: No comparator; selected severe cases only.
    - endpoints: out-of-hospital cardiac arrest; head trauma; heat stroke; seizures; emergency room death; hospital death; alcohol exposure; comorbidities
    - effectEstimatesOrDirection: Adverse-event direction: severe transfers were mostly older men; many had comorbidities or alcohol exposure; diagnoses included cardiac arrest, head trauma, heat stroke, and seizures.
    - adverseEventsOrSafetyNotes: Out-of-hospital cardiac arrest, head trauma, heat stroke, seizures, emergency-room deaths, and in-hospital deaths among selected severe transfers.
    - limitations: Single-center retrospective design.; Only severe patients requiring hospitalization or dying in the emergency room were included.; Some cardiac-arrest symptoms began in bathtubs, so not all events are pure dry-sauna exposure.; No denominator of all sauna users.
    - populationMismatch: Severe emergency cohort, older and mostly male; not healthy self-experiment users.
    - directnessToProtocol: Same broad sauna-facility context but adverse-event cohort, not protocol efficacy or dose-response evidence.
evidenceBucket: Safety, heat illness, medications, pregnancy, alcohol, older-adult risk
whyItMatters: It is one of the most directly sauna-facility-specific adverse-event sources in the batch.
potentialMurphEndpoints:
  - age and sex screen
  - alcohol-use screen
  - comorbidity screen
  - heat stroke symptoms
  - dizziness or head injury risk
protocolTakeaway: Use to justify high-risk screening, alcohol avoidance, and supervision/stop rules; do not infer incidence because there is no exposed-user denominator.
murphTakeaway: Severe sauna-facility cases cluster around older men, comorbidities, alcohol, cardiac arrest, heat stroke, and trauma—so safety gates matter.
studyDesign: Single-center retrospective observational cohort
modality: Sauna facilities, with some events beginning in facility bathtubs
claimUse: safety-only
sourceFindings:

  -
    findingId: finding:doi-10.1016-j.heliyon.2025.e43031:severe-sauna-transfer-profile
    sourceKey: source_artifact:doi-10.1016-j.heliyon.2025.e43031
    extractedFromArtifactId: art_doi_10_1016_j_heliyon_2025_e43031
    findingKind: adverse_event
    population: Twenty-five severe patients transferred from sauna facilities who required hospitalization or died in the emergency room.
    exposure: Sauna facility use before emergency transfer.
    outcome: Clinical characteristics and diagnoses.
    summary: In this single-center cohort, the 25 severe sauna-facility transfer patients had median age 72 years, were 96% male, and among those with available data many had underlying conditions or alcohol exposure; diagnoses included out-of-hospital cardiac arrest, head trauma, heat stroke, and seizures.
    evidenceUse:
      - safety

  -
    findingId: finding:doi-10.1016-j.heliyon.2025.e43031:severe-sauna-transfer-deaths
    sourceKey: source_artifact:doi-10.1016-j.heliyon.2025.e43031
    extractedFromArtifactId: art_doi_10_1016_j_heliyon_2025_e43031
    findingKind: adverse_event
    population: Severe sauna-facility transfer patients.
    exposure: Sauna facility use before emergency transfer.
    outcome: Emergency-room and in-hospital death.
    summary: The study reported four emergency-room deaths, 17 hospital admissions, and three deaths during hospitalization; because the cohort includes only severe transfers, it cannot estimate population-level incidence for sauna users.
    evidenceUse:
      - safety
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **Safety, heat illness, medications, pregnancy, alcohol, older-adult risk**.

**Findings:** In this single-center cohort, the 25 severe sauna-facility transfer patients had median age 72 years, were 96% male, and among those with available data many had underlying conditions or alcohol exposure; diagnoses included out-of-hospital cardiac arrest, head trauma, heat stroke, and seizures. The study reported four emergency-room deaths, 17 hospital admissions, and three deaths during hospitalization; because the cohort includes only severe transfers, it cannot estimate population-level incidence for sauna users.

**Why it matters:** It is one of the most directly sauna-facility-specific adverse-event sources in the batch.

**Potential experiment signals:** age and sex screen, alcohol-use screen, comorbidity screen, heat stroke symptoms, dizziness or head injury risk.

**Protocol takeaway:** Use to justify high-risk screening, alcohol avoidance, and supervision/stop rules; do not infer incidence because there is no exposed-user denominator.

**Claim use:** `safety-only`.
