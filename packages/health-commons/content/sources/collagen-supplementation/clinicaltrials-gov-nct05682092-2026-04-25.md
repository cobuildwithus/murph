---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct05682092-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct05682092-2026-04-25
title: Effects of Specific Bioactive Collagen Peptides on Skin Anti-Aging in 30-50 Year Old Women
summary: Completed registry for a collagen tripeptide drink that also contains vitamin C, hyaluronic acid, and nicotinamide; no results posted in the registry record.
status: draft
quality: usable
aliases:
- Effects of Specific Bioactive Collagen Peptides on Skin Anti-Aging in 30-50 Year Old Women
- NCT05682092
categories:
- collagen-supplementation
- skin-aging
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
    registryId: NCT05682092
    url: https://clinicaltrials.gov/study/NCT05682092
  canonicalUrl: https://clinicaltrials.gov/study/NCT05682092
  identityAliases:
  - Effects of Specific Bioactive Collagen Peptides on Skin Anti-Aging in 30-50 Year Old Women
  - NCT05682092
source:
  kind: web_page
  title: Effects of Specific Bioactive Collagen Peptides on Skin Anti-Aging in 30-50 Year Old Women
  authors: Shenzhen Precision Health Food Technology Co., Ltd.
  citation: ClinicalTrials.gov. NCT05682092. Study of Collagen Efficacy on Skin Anti-aging in 30 to 50-Year-Old Women. First posted 12 Jan 2023; last updated 12 Apr 2023.
  year: 2023
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT05682092
researchEvidence:
  designKind: other
  designLabel: Completed randomized double-blind controlled two-arm trial registry
  populationLabel: Chinese women aged 30-50 years with specified pigmentation/wrinkle visual grading criteria.
  durationLabel: 60 days / 2 months
  cohortKey: cohort:registry-direct-skin-aging-blend
  participantCount: 70
  participantCountKind: approximate
  aggregateRole: primary
evidenceBucket: skin-aging
whyItMatters: It captures a completed non-US skin registry trial with detailed drink composition and endpoints.
potentialMurphEndpoints:
- skin elasticity
- skin moisture
- TEWL
- wrinkles
- VISIA
protocolTakeaway: Use as registry/context only and flag vitamin C/HA/nicotinamide co-ingredients.
murphTakeaway: Dose and co-ingredients must be logged because a collagen drink may deliver >10 g/day collagen plus multiple actives.
studyDesign: rct
modality: oral collagen-tripeptide drink with co-ingredients
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: skin-aging
  directness: direct_protocol
  claimUse: context-only
  priority: medium
  batchId: batch-005
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **skin-aging**.

**Findings:** High-dose collagen drink registry is direct to skin endpoints but adjacent for collagen-only attribution because of co-ingredients. Endpoints captured: skin elasticity; skin moisture; TEWL/skin barrier; lines/wrinkles; VISIA skin diagnosis.

**Why it matters:** It captures a completed non-US skin registry trial with detailed drink composition and endpoints.

**Potential experiment signals:** skin elasticity, skin moisture, TEWL, wrinkles, VISIA.

**Protocol takeaway:** Use as registry/context only and flag vitamin C/HA/nicotinamide co-ingredients.

**Claim use:** `context-only`.
