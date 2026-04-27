---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-gov-nct03370848-2026-04-26"
slug: "sources/psyllium-husk/clinicaltrials-gov-nct03370848-2026-04-26"
title: "Effects of Psyllium on Niacin Tolerability"
summary: "ClinicalTrials.gov registry record for a completed Phase 4 crossover/supportive-care study of psyllium on niacin tolerability, including flushing and cholesterol-related context but not a primary psyllium LDL-C protocol."
status: "draft"
quality: "usable"
aliases:
  - "Effects of Psyllium on Niacin Tolerability"
  - "NCT03370848"
categories:
  - "psyllium-husk"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:psyllium-husk"
source:
  kind: "other"
  title: "Effects of Psyllium on Niacin Tolerability"
  authors: "ClinicalTrials.gov; sponsor: VA Greater Los Angeles Healthcare System"
  year: 2017
  journal: "ClinicalTrials.gov"
  url: "https://clinicaltrials.gov/study/NCT03370848"
  citation: "ClinicalTrials.gov; sponsor: VA Greater Los Angeles Healthcare System. (2017). Effects of Psyllium on Niacin Tolerability. ClinicalTrials.gov. NCT03370848. https://clinicaltrials.gov/study/NCT03370848"
sourceIdentity:
  identityKind: "trial_registry"
  canonicalIdBasis: "registry_id"
  identifiers:
    registryId: "NCT03370848"
    url: "https://clinicaltrials.gov/study/NCT03370848"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT03370848"
researchEvidence:
  designKind: "crossover_trial"
  designLabel: "crossover"
  populationLabel: "Adults using niacin/aspirin protocol; exact cardiovascular-risk criteria to verify"
  durationLabel: "Registered crossover trial; duration/results details not fully extracted."
  aggregateRole: "primary"
  cohortKey: "cohort:clinicaltrials-gov-nct03370848-2026-04-26:source-population"
  notes:
    - "Batch batch-005 extraction; claim use safety-only."
    - "Limitations: Registry record; results not extracted.; Psyllium used in a niacin/aspirin tolerability context."
    - "Population mismatch: Niacin-flushing/tolerability setting, not psyllium monotherapy for cholesterol."
evidenceBucket: "Safety, adverse events, and drug-interaction boundaries"
whyItMatters: "Safety/tolerability and lipid-drug interaction boundary; psyllium is not the main cholesterol-lowering intervention."
potentialMurphEndpoints:
  - "niacin flushing"
  - "cholesterol levels"
  - "tolerability"
protocolTakeaway: "Do not cite this registry as evidence that psyllium lowers LDL-C; use it only to flag medication-adjunct/tolerability research context."
murphTakeaway: "Murph extraction should preserve this source as safety/context evidence and avoid promoting it into a direct LDL-C claim."
studyDesign: "crossover"
modality: "oral psyllium husk / ispaghula husk safety, tolerability, label, or adjacent context"
claimUse: "safety-only"
sourceFindings:
  -
    findingId: "finding:clinicaltrials-gov-nct03370848-2026-04-26-niacin-tolerability-registry"
    sourceKey: "source_artifact:clinicaltrials-gov-nct03370848-2026-04-26"
    extractedFromArtifactId: "art_clinicaltrials_gov_nct03370848_2026_04_26"
    findingKind: "context"
    population: "Adults in a registered niacin/aspirin tolerability protocol; exact criteria not extracted."
    exposure: "Psyllium used to evaluate niacin tolerability/flushing while lipid outcomes may be measured."
    outcome: "Niacin flushing, tolerability, and cholesterol-level context."
    summary: "The registry identifies a crossover supportive-care study of psyllium on niacin tolerability; it is not source evidence for psyllium as the main cholesterol-lowering intervention."
    evidenceUse:
      - "context"
      - "safety"
murphV1Priority: "Low"
pdfRightsStatus: "unknown"
interventionOrExposure: "Psyllium used to reduce niacin flushing/tolerability while measuring niacin effect on cholesterol levels"
comparatorOrControl: "Not applicable or not extracted for this safety/context source."
durationOrFollowUp: "Registered crossover trial; duration/results details not fully extracted."
endpoints:
  - "niacin flushing"
  - "cholesterol levels"
  - "tolerability"
adverseEventsOrSafetyNotes: []
limitations:
  - "Registry record; results not extracted."
  - "Psyllium used in a niacin/aspirin tolerability context."
populationMismatch: "Niacin-flushing/tolerability setting, not psyllium monotherapy for cholesterol."
directnessToProtocol: "general_guideline"
---
This source is included for **Safety, adverse events, and drug-interaction boundaries**.

**Findings:**

- `finding:clinicaltrials-gov-nct03370848-2026-04-26-niacin-tolerability-registry` — The registry identifies a crossover supportive-care study of psyllium on niacin tolerability; it is not source evidence for psyllium as the main cholesterol-lowering intervention.

**Why it matters:** Safety/tolerability and lipid-drug interaction boundary; psyllium is not the main cholesterol-lowering intervention.

**Potential experiment signals:**

- niacin flushing
- cholesterol levels
- tolerability

**Protocol takeaway:** Do not cite this registry as evidence that psyllium lowers LDL-C; use it only to flag medication-adjunct/tolerability research context.

**Limitations and population mismatch:** Registry record; results not extracted.; Psyllium used in a niacin/aspirin tolerability context. Population mismatch: Niacin-flushing/tolerability setting, not psyllium monotherapy for cholesterol.

**Claim use:** `safety-only`.
