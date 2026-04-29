---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-gov-nct00507715-2026-04-26"
slug: "sources/psyllium-husk/clinicaltrials-gov-nct00507715-2026-04-26"
title: "Effect of Plantago Ovata Husk on Levodopa Pharmacokinetics and Biochemical Parameters in Patients With Parkinson Disease"
summary: "ClinicalTrials.gov registry record for Plantago ovata husk and levodopa pharmacokinetics in Parkinson disease, with biochemical lipid measures as secondary context."
status: "draft"
quality: "usable"
aliases:
  - "NCT00507715"
  - "Plantago ovata levodopa pharmacokinetics trial"
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
  kind: "web_page"
  title: "Effect of Plantago Ovata Husk on Levodopa Pharmacokinetics and Biochemical Parameters in Patients With Parkinson Disease"
  authors: "Registry sponsor/record holder: Rottapharm Spain"
  year: 2007
  journal: "ClinicalTrials.gov"
  citation: "ClinicalTrials.gov. Effect of Plantago Ovata Husk on Levodopa Pharmacokinetics and Biochemical Parameters in Patients With Parkinson Disease. NCT00507715. Registry record. Extracted 2026-04-26."
  url: "https://clinicaltrials.gov/study/NCT00507715"
sourceIdentity:
  identityKind: "trial_registry"
  canonicalIdBasis: "registry_id"
  identifiers:
    registryId: "NCT00507715"
    titleHash: "7e002de4eb986d8b3ecb9591bfa50885d1654906b99d982da3b7388d69446fbc"
    url: "https://clinicaltrials.gov/study/NCT00507715"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT00507715"
researchEvidence:
  designKind: "crossover_trial"
  designLabel: "Randomized placebo-controlled double-blind cross-over pharmacokinetic registry record"
  participantCount: 18
  participantCountKind: "reported"
  populationLabel: "Adults age 60–80 years with idiopathic Parkinson disease controlled with levodopa/carbidopa."
  durationLabel: "Pharmacokinetic crossover duration not fully extracted from accessible registry text."
  aggregateRole: "context"
  cohortKey: "nct00507715"
  notes:
    - "Directness to protocol: measurement_context."
    - "Population mismatch: Older Parkinson disease patients on levodopa rather than general adults using psyllium for cholesterol."
    - "Parkinson disease population using levodopa/carbidopa."
    - "Primary endpoint is pharmacokinetics, not lipid lowering."
    - "No registry-extracted cholesterol effects or adverse-event rates."
sourceKind: "trial_registry"
evidenceBucket: "Registries and unpublished protocols"
directness: "measurement_context"
whyItMatters: "Provides a drug-interaction/pharmacokinetic boundary for psyllium-like fibers and medications; lipid measures are secondary and population-mismatched."
potentialMurphEndpoints:
  - "L-dopa absorption and elimination"
  - "total cholesterol"
  - "HDL-C"
  - "LDL-C"
  - "glycemia"
protocolTakeaway: "Use only as safety/measurement context around possible medication interaction timing; not as cholesterol efficacy evidence."
murphTakeaway: "Medication-spacing guardrail source rather than a cholesterol protocol source."
studyDesign: "Randomized, placebo-controlled, double-blind cross-over phase 1 trial"
modality: "psyllium husk / Plantago ovata fiber intervention or registry context"
claimUse: "context-only"
limitations:
  - "Parkinson disease population using levodopa/carbidopa."
  - "Primary endpoint is pharmacokinetics, not lipid lowering."
  - "No registry-extracted cholesterol effects or adverse-event rates."
populationMismatch: "Older Parkinson disease patients on levodopa rather than general adults using psyllium for cholesterol."
interventionOrExposure: "Plantago ovata husk; dose was not reliably extracted from the registry page in this batch."
comparatorOrControl: "Hemicellulose crystalline placebo/control in cross-over arms."
durationOrFollowUp: "Pharmacokinetic crossover duration not fully extracted from accessible registry text."
endpoints: "Primary L-dopa pharmacokinetic absorption/elimination; secondary biochemical parameters included total cholesterol, HDL-C, LDL-C, and glycemia."
effectEstimatesOrDirection: "No registry-extracted lipid or pharmacokinetic effect estimates."
adverseEventsOrSafetyNotes: "Safety relevance is medication-interaction boundary; allergy/contraindication to Plantago ovata was an exclusion."
artifactCandidates:
  - "art-clinicaltrials-gov-nct00507715-2026-04-26"
sourceFindings:

  -
    findingId: "finding:clinicaltrials-gov-nct00507715-levodopa-pharmacokinetic-boundary"
    sourceKey: "source_artifact:clinicaltrials-gov-nct00507715-2026-04-26"
    extractedFromArtifactId: "art-clinicaltrials-gov-nct00507715-2026-04-26"
    findingKind: "safety"
    population: "Adults age 60–80 years with idiopathic Parkinson disease controlled with levodopa/carbidopa."
    exposure: "Plantago ovata husk; dose was not reliably extracted from the registry page in this batch."
    outcome: "Primary L-dopa pharmacokinetic absorption/elimination; secondary biochemical parameters included total cholesterol, HDL-C, LDL-C, and glycemia."
    summary: "Registry protocol studied Plantago ovata effects on levodopa pharmacokinetics in Parkinson disease, with lipid measures secondary; this is a medication-interaction and measurement-context source, not cholesterol efficacy evidence."
    evidenceUse:
      - "safety"
      - "measurement"
      - "context"
murphV1Priority: "Low"
pdfRightsStatus: "unknown"
---
This source is included for **Registries and unpublished protocols**.

**Findings:** Registry protocol studied Plantago ovata effects on levodopa pharmacokinetics in Parkinson disease, with lipid measures secondary; this is a medication-interaction and measurement-context source, not cholesterol efficacy evidence.

**Why it matters:** Provides a drug-interaction/pharmacokinetic boundary for psyllium-like fibers and medications; lipid measures are secondary and population-mismatched.

**Potential experiment signals:** L-dopa absorption and elimination, total cholesterol, HDL-C, LDL-C, glycemia.

**Protocol takeaway:** Use only as safety/measurement context around possible medication interaction timing; not as cholesterol efficacy evidence.

**Claim use:** `context-only`.

**Directness:** `measurement_context`.

**Population mismatch:** Older Parkinson disease patients on levodopa rather than general adults using psyllium for cholesterol.

**Limitations:** Parkinson disease population using levodopa/carbidopa.; Primary endpoint is pharmacokinetics, not lipid lowering.; No registry-extracted cholesterol effects or adverse-event rates.

**Safety notes:** Safety relevance is medication-interaction boundary; allergy/contraindication to Plantago ovata was an exclusion.
