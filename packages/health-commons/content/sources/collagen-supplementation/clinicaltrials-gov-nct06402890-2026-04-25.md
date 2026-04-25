---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct06402890-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct06402890-2026-04-25
title: Resistance Training and Hydrolyzed Collagen Supplementation
summary: ClinicalTrials.gov registry for hydrolyzed collagen plus resistance training and muscle-tendon unit outcomes; keep as context-only due to absent results and population-detail uncertainty.
status: draft
quality: usable
aliases:
- Resistance Training and Hydrolyzed Collagen Supplementation
- NCT06402890
categories:
- collagen-supplementation
- tendon-loading-ligament
- direct_protocol
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
    registryId: NCT06402890
    url: https://clinicaltrials.gov/study/NCT06402890
  canonicalUrl: https://clinicaltrials.gov/study/NCT06402890
  identityAliases:
  - Resistance Training and Hydrolyzed Collagen Supplementation
  - NCT06402890
source:
  kind: web_page
  title: Resistance Training and Hydrolyzed Collagen Supplementation
  authors: ClinicalTrials.gov
  citation: 'ClinicalTrials.gov. NCT06402890: Resistance Training and Hydrolyzed Collagen Supplementation. First posted 7 May 2024.'
  year: 2024
  journal: ClinicalTrials.gov trial registry
  url: https://clinicaltrials.gov/study/NCT06402890
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: rct
  populationLabel: Healthy active adults; extracted snippets contained age/population ambiguity.
  durationLabel: Approximately 8-12 weeks / 24 resistance-training sessions in extracted protocol snippets
  cohortKey: clinicaltrials-gov-nct06402890-2026-04-25
  aggregateRole: context
evidenceBucket: tendon-loading-ligament
whyItMatters: It aligns with direct tendon adaptation trials using HCP, vitamin C, and resistance training.
potentialMurphEndpoints:
- tendon CSA
- tendon stiffness
- Young’s modulus
- rate of force development
- muscle thickness
protocolTakeaway: Registry-only evidence can guide endpoint vocabulary but cannot support efficacy claims.
murphTakeaway: Registry-only evidence can guide endpoint vocabulary but cannot support efficacy claims.
studyDesign: rct
modality: hydrolyzed_collagen_plus_resistance_training_registry
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: tendon-loading-ligament
  directness: direct_protocol
  claimUse: context-only
  priority: medium
  batchId: batch-006
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **tendon-loading-ligament**.

**Findings:** Registry record only; no results extracted.

**Population and intervention:** Registry for resistance training and hydrolyzed collagen supplementation in healthy adults; extracted snippets conflicted about age range and enrollment, so verify before synthesis. Intervention/exposure: Hydrolyzed collagen, often described as 30 g with 50 mg vitamin C, paired with high-volume/high-intensity lower-body resistance training. Comparator/control: Calorie-matched maltodextrin placebo with vitamin C plus the same training. Duration/follow-up: Approximately 8-12 weeks / 24 resistance-training sessions in extracted protocol snippets.

**Endpoints:** Muscle-tendon unit structure and function, tendon size, tendon stiffness, strength, rate of force development, ultrasound and dynamometry outcomes.

**Safety notes:** No adverse-event results extracted.

**Limitations:** Registry-only source.; Population/enrollment details conflicted across extracted snippets.; No results available.

**Population mismatch:** Direct loading/HCP protocol but not clinical tendinopathy evidence.

**Why it matters:** It aligns with direct tendon adaptation trials using HCP, vitamin C, and resistance training.

**Potential experiment signals:** tendon CSA; tendon stiffness; Young’s modulus; rate of force development; muscle thickness

**Protocol takeaway:** Registry-only evidence can guide endpoint vocabulary but cannot support efficacy claims.

**Claim use:** `context-only`. Directness: `direct_protocol`. Source key: `source_artifact:clinicaltrials-gov-nct06402890-2026-04-25`.
