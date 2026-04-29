---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct01475201-2026-04-26
slug: sources/daily-step-floor/clinicaltrials-nct01475201-2026-04-26
title: 'NCT01475201: Step Monitoring to Improve ARTERial Health'
summary: ClinicalTrials.gov registry record for SMARTER, a trial of step monitoring and physician step prescriptions for arterial-health outcomes. The registry/design artifact is context only and should not be merged with separate SMARTER result publications.
status: draft
quality: usable
aliases:
- 'NCT01475201: Step Monitoring to Improve ARTERial Health'
- NCT01475201
- clinicaltrials-nct01475201-2026-04-26
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: external_protocol
  title: 'NCT01475201: Step Monitoring to Improve ARTERial Health'
  authors: ClinicalTrials.gov; Research Institute of the McGill University Health Centre
  year: 2026
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT01475201
  citation: ClinicalTrials.gov. Step Monitoring to Improve ARTERial Health (SMARTER). NCT01475201. Accessed 2026-04-26.
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: NCT01475201
    titleHash: 1ba470011d088a17e57c1693e331ff197b16a2e39026e5febd2fe23661bff71e
    url: https://clinicaltrials.gov/study/NCT01475201
  canonicalUrl: https://clinicaltrials.gov/study/NCT01475201
researchEvidence:
  designKind: retrospective_registry
  designLabel: Registry record for SMARTER step-monitoring arterial-health trial
  populationLabel: Sedentary/low-active adults with BMI 25 to <40 followed for type 2 diabetes and/or hypertension by collaborating physicians, per linked design context.
  durationLabel: 1 year planned follow-up
  cohortKey: daily-step-floor:batch-009:clinicaltrials-nct01475201-2026-04-26
  participantCount: 364
  aggregateRole: context
evidenceBucket: cardiometabolic_fitness_endpoints
whyItMatters: Identifies arterial-stiffness and vascular-risk endpoints for a step-prescription trial without importing results from separate publications.
potentialMurphEndpoints:
- biomarker:daily-steps
- biomarker:arterial-stiffness
- biomarker:vascular-risk
- biomarker:body-weight
protocolTakeaway: Use as registry/design context only; do not use as efficacy evidence.
murphTakeaway: Daily Step Floor can be framed with arterial-health endpoints, but result claims require separate publication extraction.
studyDesign: other
modality: step monitoring / physician step prescription
claimUse: context-only
sourceFindings:
- findingId: finding:clinicaltrials-nct01475201-2026-04-26:registry-design-context
  sourceKey: source_artifact:clinicaltrials-nct01475201-2026-04-26
  extractedFromArtifactId: art_clinicaltrials_nct01475201_2026_04_26
  findingKind: context
  population: Sedentary/low-active overweight adults in care for diabetes and/or hypertension
  exposure: Step monitoring with physician step-count prescription
  outcome: Arterial stiffness and vascular risk endpoints
  summary: The registry/design context identifies a 1-year SMARTER trial with step monitoring and a target increase of at least 3,000 steps/day; it does not provide efficacy results in this artifact.
  evidenceUse:
  - context
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **cardiometabolic_fitness_endpoints**.

**Findings:** ClinicalTrials.gov registry record for SMARTER, a trial of step monitoring and physician step prescriptions for arterial-health outcomes. The registry/design artifact is context only and should not be merged with separate SMARTER result publications.

**Why it matters:** Identifies arterial-stiffness and vascular-risk endpoints for a step-prescription trial without importing results from separate publications.

**Potential experiment signals:** biomarker:daily-steps, biomarker:arterial-stiffness, biomarker:vascular-risk, biomarker:body-weight.

**Protocol takeaway:** Use as registry/design context only; do not use as efficacy evidence.

**Claim use:** `context-only`.

**Directness boundary:** `direct_protocol`. This source should not be promoted beyond that scope in the Daily Step Floor protocol.

**Safety/adverse events:** No adverse-event result extracted from registry/design artifact.

**Limitations and population mismatch:** Registry/design context only; trial results must be handled as separate source artifacts. Population mismatch: Sedentary/low-active overweight adults in clinical care for diabetes/hypertension; not general users.
