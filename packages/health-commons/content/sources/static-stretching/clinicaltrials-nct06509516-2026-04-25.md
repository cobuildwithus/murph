---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-nct06509516-2026-04-25"
slug: "sources/static-stretching/clinicaltrials-nct06509516-2026-04-25"
title: "Effect of the Modified Sleeper-Stretch on the Elasticity of the Posterior and Posteroinferior Glenohumeral Capsule"
summary: "ClinicalTrials.gov registry record for a planned non-randomized modified sleeper-stretch study measuring glenohumeral capsule elasticity with shear-wave elastography."
status: "draft"
quality: "usable"
aliases:
  - "NCT06509516"
  - "ClinicalTrials.gov NCT06509516"
  - "Modified sleeper-stretch capsule elasticity registry"
categories:
  - "static-stretching"
  - "shoulder-rom"
  - "upper-body-rom"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:static-stretching/at-home-static-stretching-for-flexibility"
  -
    type: "parent_family"
    target: "experiment_family:static-stretching"
sourceIdentity:
  identityKind: "trial_registry"
  canonicalIdBasis: "registry_id"
  identifiers:
    registryId: "NCT06509516"
    url: "https://clinicaltrials.gov/study/NCT06509516"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT06509516"
  identityAliases:
    - "NCT06509516"
source:
  kind: "web_page"
  title: "Effect of the Modified Sleeper-Stretch on the Elasticity of the Posterior and Posteroinferior Glenohumeral Capsule"
  authors: "University of Alcalá; ClinicalTrials.gov"
  year: 2024
  journal: "ClinicalTrials.gov"
  url: "https://clinicaltrials.gov/study/NCT06509516"
  citation: "ClinicalTrials.gov. Effect of the Modified Sleeper-Stretch on the Elasticity of the Posterior and Posteroinferior Glenohumeral Capsule. NCT06509516. Accessed 2026-04-25."
researchEvidence:
  designKind: "other"
  designLabel: "Registered non-randomized interventional trial; no results posted in extracted record"
  participantCount: 64
  participantCountKind: "reported"
  populationLabel: "Adults aged 18-59 years with either unilateral nonspecific shoulder pain history or no shoulder pain"
  durationLabel: "28-day daily self-administered modified sleeper stretch with follow-up 4 weeks after completion"
  aggregateRole: "context"
  cohortKey: "nct06509516-modified-sleeper-capsule-elasticity"
evidenceBucket: "shoulder_thoracic_upper_body"
whyItMatters: "It identifies an ongoing direct-mechanism research gap for capsule elasticity and a feasible home dose, but it is not an efficacy result."
potentialMurphEndpoints:
  - "Posterior and posteroinferior glenohumeral capsule elasticity"
  - "Modified sleeper-stretch adherence"
  - "Follow-up elasticity after washout"
protocolTakeaway: "Use only as context for forthcoming evidence and dose/mechanism monitoring; do not cite as evidence that stretching improves ROM or capsule elasticity."
murphTakeaway: "Registry status and future results should be monitored before using capsule-elasticity claims in user-facing protocol language."
studyDesign: "Trial registry for a quasi-experimental, non-randomized, open-label, parallel assignment study."
modality: "Self-administered modified sleeper stretch: 3 x 30-second holds with 30-second rest daily for 28 days."
directnessToProtocol: "same_mechanism"
claimUse: "context-only"
murphV1Priority: "Medium"
pdfRightsStatus: "unknown"
---
This source is included for **shoulder_thoracic_upper_body**.

**Findings:**
- **Design/status:** Registry record for a non-randomized interventional study; no results were extracted.
- **Planned dose:** 3 modified sleeper stretches for 30 seconds, with 30-second rests, daily for 28 days.
- **Planned endpoints:** Shear-wave elastography of posterior/posteroinferior glenohumeral capsule elasticity at baseline, completion, and 4-week follow-up.
- **Limits/safety:** Not efficacy evidence; excludes people unable to perform the stretch due to pain and several shoulder/systemic conditions.

**Why it matters:** It identifies an ongoing direct-mechanism research gap for capsule elasticity and a feasible home dose, but it is not an efficacy result.

**Potential experiment signals:** registered dose, capsule-elasticity endpoint, trial-status watchlist, pain-related exclusion boundary.

**Protocol takeaway:** Use only as context for forthcoming evidence and dose/mechanism monitoring; do not cite as evidence that stretching improves ROM or capsule elasticity.

**Claim use:** `context-only`.
