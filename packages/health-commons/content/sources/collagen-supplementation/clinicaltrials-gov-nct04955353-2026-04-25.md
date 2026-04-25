---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct04955353-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct04955353-2026-04-25
title: Efficacy of Hydrolyzed Chicken Collagen Type II in Joint Health
summary: Registry for hydrolyzed chicken collagen type-II joint-health RCT; adjacent type-II-specific evidence.
status: draft
quality: usable
aliases:
- Efficacy of Hydrolyzed Chicken Collagen Type II in Joint Health
- clinicaltrials-gov-nct04955353-2026-04-25
- NCT04955353
categories:
- collagen-supplementation
- joint-osteoarthritis
- adjacent_variant
- context-only
relations:
-
  type: related_protocol
  target: protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides
-
  type: parent_family
  target: experiment_family:collagen-supplementation
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT04955353
    url: https://clinicaltrials.gov/study/NCT04955353
  canonicalUrl: https://clinicaltrials.gov/study/NCT04955353
  identityAliases:
  - Efficacy of Hydrolyzed Chicken Collagen Type II in Joint Health
  - clinicaltrials-gov-nct04955353-2026-04-25
  - NCT04955353
source:
  kind: web_page
  title: Efficacy of Hydrolyzed Chicken Collagen Type II in Joint Health
  authors: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Efficacy of Hydrolyzed Chicken Collagen Type II in Joint Health. NCT04955353. Accessed 2026-04-25.
  year: 2026
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT04955353
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Trial registry record for randomized hydrolyzed chicken collagen type-II study
  populationLabel: Adults aged 40-65 with joint discomfort in linked publication
  durationLabel: 8 weeks in linked publication
  cohortKey: nct04955353-hydrolyzed-chicken-collagen-type-ii-registry
  participantCount: 90
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: joint-osteoarthritis
whyItMatters: Important registry boundary for hydrolyzed type-II products and joint discomfort populations.
potentialMurphEndpoints:
- WOMAC pain
- WOMAC stiffness
- WOMAC physical function
- joint discomfort
- safety
protocolTakeaway: Use as adjacent type-II hydrolysate context only unless the protocol explicitly allows that variant.
murphTakeaway: Record collagen type and source; type-II chicken collagen should not be silently pooled with type I/III powders.
studyDesign: Trial registry record for randomized hydrolyzed chicken collagen type-II study
modality: hydrolyzed chicken collagen type II, not generic type I/III HCP
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: joint-osteoarthritis
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  batchId: batch-003
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **joint-osteoarthritis**.

**Findings:** The registry describes an efficacy trial of hydrolyzed chicken collagen type II in joint health. A linked publication appears to report 90 adults with joint discomfort randomized to HC-II versus placebo for eight weeks, with WOMAC improvements. This remains adjacent because the intervention is type-II-specific hydrolyzed chicken collagen.

**Why it matters:** Important registry boundary for hydrolyzed type-II products and joint discomfort populations.

**Potential experiment signals:** WOMAC pain, WOMAC stiffness, WOMAC physical function, joint discomfort, safety

**Protocol takeaway:** Use as adjacent type-II hydrolysate context only unless the protocol explicitly allows that variant.

**Claim use:** `context-only`.
