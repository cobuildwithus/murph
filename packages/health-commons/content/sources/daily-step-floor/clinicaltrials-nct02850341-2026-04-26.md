---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct02850341-2026-04-26
slug: sources/daily-step-floor/clinicaltrials-nct02850341-2026-04-26
title: Step Away From Depression - Evaluation of a Pedometer Intervention With Inpatients With Major Depression (SAD)
summary: Registry record documents the Step Away from Depression pedometer trial design.
status: draft
quality: usable
aliases:
- clinicaltrials-nct02850341-2026-04-26
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: external_protocol
  title: Step Away From Depression - Evaluation of a Pedometer Intervention With Inpatients With Major Depression (SAD)
  authors: ClinicalTrials.gov
  year: 2016
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT02850341
  citation: ClinicalTrials.gov. Step Away From Depression - Evaluation of a Pedometer Intervention With Inpatients With Major Depression (SAD). NCT02850341.
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: NCT02850341
    titleHash: 578deb1e547f84ff09c14a9f1c4ed04909dd0033fb5de325ed1d0ee93c91d419
    url: https://clinicaltrials.gov/study/NCT02850341
  canonicalUrl: https://clinicaltrials.gov/study/NCT02850341
researchEvidence:
  designKind: retrospective_registry
  designLabel: ClinicalTrials.gov registry record for a randomized pedometer intervention trial
  populationLabel: Psychiatric inpatients with major depression
  durationLabel: Planned assessments during inpatient care and after discharge
  cohortKey: daily-step-floor-clinicaltrials-nct02850341-2026-04-26
  participantCount: 400
  aggregateRole: primary
evidenceBucket: mental_health_sleep_qol
whyItMatters: Links the Step Away from Depression trial family to the protocol and results publications without duplicating efficacy claims.
potentialMurphEndpoints:
- biomarker:daily-steps
- biomarker:depressive-symptoms
protocolTakeaway: Use as registry context for trial design, eligibility, and planned endpoints only.
murphTakeaway: Keep as context-only and link to SAD result/protocol records.
studyDesign: rct
modality: daily-step / pedometer / walking
claimUse: context-only
sourceFindings:
- findingId: finding:clinicaltrials-nct02850341-2026-04-26:mental-health-sleep-qol
  sourceKey: source_artifact:clinicaltrials-nct02850341-2026-04-26
  extractedFromArtifactId: art_clinicaltrials_nct02850341_2026_04_26
  findingKind: context
  population: Psychiatric inpatients with major depression
  exposure: Pedometer intervention for depressive inpatients in psychiatric clinics
  outcome: daily physical activity; depression outcomes; trial design and eligibility
  summary: The ClinicalTrials.gov record for NCT02850341 describes a planned randomized evaluation of whether pedometers can help depressive inpatients increase physical activity; it is not a results source.
  evidenceUse:
  - context
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **mental_health_sleep_qol**.

**Findings:** The ClinicalTrials.gov record for NCT02850341 describes a planned randomized evaluation of whether pedometers can help depressive inpatients increase physical activity; it is not a results source.

**Why it matters:** Links the Step Away from Depression trial family to the protocol and results publications without duplicating efficacy claims.

**Potential experiment signals:** biomarker:daily-steps, biomarker:depressive-symptoms.

**Protocol takeaway:** Use as registry context for trial design, eligibility, and planned endpoints only.

**Claim use:** `context-only`.

**Directness boundary:** This source is classified as `direct_protocol` for Daily Step Floor. Do not promote adjacent, observational, registry/protocol, or clinical-population findings into direct protocol claims.

**Safety/adverse events:** Registry extraction in this batch did not identify adverse-event results; use the results publication for outcomes.
