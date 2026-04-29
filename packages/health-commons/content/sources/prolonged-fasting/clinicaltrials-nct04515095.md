---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct04515095
slug: sources/prolonged-fasting/clinicaltrials-nct04515095
title: Water-only Fasting in the Treatment of Hypertension Patients
summary: 'Water-only Fasting in the Treatment of Hypertension Patients is included as clinical/residential supervised fasting boundary: Use for supervision and duration-boundary context, not as direct evidence that a 24–72 hour wellness fast improves blood pressure.'
status: draft
quality: usable
aliases:
- Water-only Fasting in the Treatment of Hypertension Patients
- NCT04515095
categories:
- prolonged-fasting
relations:
- type: related_protocol
  target: protocol_variant:prolonged-fasting/prolonged-fasting-24-72-hours
- type: parent_family
  target: experiment_family:prolonged-fasting
source:
  kind: web_page
  title: Water-only Fasting in the Treatment of Hypertension Patients
  authors: ClinicalTrials.gov record
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov record. Water-only Fasting in the Treatment of Hypertension Patients. ClinicalTrials.gov. n.d..
  url: https://clinicaltrials.gov/study/NCT04515095
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: NCT04515095
    titleHash: e312782b452cec09d1640c2fca437dd4e2507ab3e21fc88aea5fc0993621a906
    url: https://clinicaltrials.gov/study/NCT04515095
  canonicalUrl: https://clinicaltrials.gov/study/NCT04515095
researchEvidence:
  designKind: other
  designLabel: trial registry; prospective open-label single-arm intervention
  populationLabel: Adults with stage 1 or stage 2 hypertension in a medically supervised setting.
  durationLabel: At least 7 days of water-only fasting with supervised refeeding and follow-up; exceeds 72 hours.
  aggregateRole: primary
  cohortKey: cohort:clinicaltrials-nct04515095
  participantCount: 30
  participantCountKind: reported
evidenceBucket: Clinical/residential supervised fasting boundary
whyItMatters: Defines a modern clinical water-only fasting boundary where long fasts are paired with supervision, adverse-event monitoring, and refeeding.
potentialMurphEndpoints:
- hydration
- electrolytes
- refeeding
- red flags
- user-facing safety
protocolTakeaway: Use for supervision and duration-boundary context, not as direct evidence that a 24–72 hour wellness fast improves blood pressure.
murphTakeaway: Use for supervision and duration-boundary context, not as direct evidence that a 24–72 hour wellness fast improves blood pressure.
studyDesign: trial registry; prospective open-label single-arm intervention
modality: water-only fasting plus refeeding
claimUse: context-only
sourceFindings:
- findingId: finding:clinicaltrials-nct04515095-01
  sourceKey: source_artifact:clinicaltrials-nct04515095
  extractedFromArtifactId: art_clinicaltrials_nct04515095
  findingKind: context
  population: Adults with hypertension
  exposure: Prolonged water-only fasting followed by whole-plant-food refeeding
  outcome: safety, feasibility, and blood pressure
  summary: Registry describes a prospective open-label single-arm clinical intervention in hypertension with safety/feasibility and blood-pressure outcomes; fast length exceeds the target 24–72 hour protocol.
  evidenceUse:
  - context
  - safety
murphV1Priority: High
pdfRightsStatus: unknown
---

This source is included for **Clinical/residential supervised fasting boundary**.

**Findings:** Registry describes a prospective open-label single-arm clinical intervention in hypertension with safety/feasibility and blood-pressure outcomes; fast length exceeds the target 24–72 hour protocol.

**Why it matters:** Defines a modern clinical water-only fasting boundary where long fasts are paired with supervision, adverse-event monitoring, and refeeding.

**Potential experiment signals:** blood pressure, adverse events, retention/feasibility, electrolytes/hydration.

**Protocol takeaway:** Use for supervision and duration-boundary context, not as direct evidence that a 24–72 hour wellness fast improves blood pressure.

**Claim use:** `context-only`.

## Extraction details

- **Population:** Adults with stage 1 or stage 2 hypertension in a medically supervised setting.
- **Intervention/exposure:** Prolonged water-only fasting followed by whole-plant-food refeeding.
- **Comparator/control:** No randomized comparator in the registry-described single-arm design.
- **Duration/follow-up:** At least 7 days of water-only fasting with supervised refeeding and follow-up; exceeds 72 hours.
- **Endpoints:** safety, feasibility, blood pressure, cardiometabolic markers, adverse events
- **Effect estimate or direction:** Registry context; later linked publication reports feasibility/safety, but this extraction keeps the registry as context rather than a protocol-result claim.
- **Adverse events/safety notes:** Registry focus includes safety and adverse events; no registry adverse-event rate is used as a direct protocol claim.
- **Limitations:** Single-arm clinical hypertension setting; intervention duration exceeds the protocol window and includes supervised refeeding.
- **Population mismatch:** Hypertension treatment population and residential clinical supervision differ from healthy 24–72 hour use.
- **Directness to Prolonged Fasting (24–72 Hours):** clinical_supervised
- **Artifact/rights note:** No copyrighted PDF is stored in Git for this draft. Rights status: `unknown`.
