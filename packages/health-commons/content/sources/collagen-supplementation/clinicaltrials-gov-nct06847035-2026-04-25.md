---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct06847035-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct06847035-2026-04-25
title: Efficacy of Oral Collagen Peptide on Skin Condition
summary: Completed ClinicalTrials.gov registry for 5 g/day oral collagen peptide over 12 weeks plus washout/regression; no registry results posted, but a derived publication link is listed.
status: draft
quality: usable
aliases:
- Efficacy of Oral Collagen Peptide on Skin Condition
- NCT06847035
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
    registryId: NCT06847035
    url: https://clinicaltrials.gov/study/NCT06847035
  canonicalUrl: https://clinicaltrials.gov/study/NCT06847035
  identityAliases:
  - Efficacy of Oral Collagen Peptide on Skin Condition
  - NCT06847035
source:
  kind: web_page
  title: Efficacy of Oral Collagen Peptide on Skin Condition
  authors: Shanghai Meifute Biotechnology Co., Ltd
  citation: ClinicalTrials.gov. NCT06847035. Efficacy Study of Oral Collagen Peptide on Skin Condition Improvement. First posted 26 Feb 2025; last updated 28 Feb 2025.
  year: 2025
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT06847035
researchEvidence:
  designKind: other
  designLabel: Completed randomized double-blind controlled single-site trial registry
  populationLabel: Healthy female adults aged 35-55 years with fine wrinkles and skin laxity.
  durationLabel: 12 weeks plus 4-week regression phase
  cohortKey: cohort:registry-direct-skin-aging
  participantCount: 90
  participantCountKind: approximate
  aggregateRole: primary
evidenceBucket: skin-aging
whyItMatters: It captures dose, duration, washout/regression follow-up, and skin-density endpoints for a direct collagen-peptide trial.
potentialMurphEndpoints:
- 5 g/day
- skin thickness
- skin density
- firmness
- hydration
- TEWL
- washout/regression
protocolTakeaway: Use as registry context only; cite the paired publication separately when extracted.
murphTakeaway: Post-intake follow-up is valuable when testing whether perceived effects persist after stopping supplementation.
studyDesign: rct
modality: oral collagen peptide solid beverage
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

**Findings:** Direct 5 g/day collagen-peptide registry with density/thickness/firmness endpoints and a 4-week post-intake phase. Endpoints captured: skin firmness; skin thickness; skin density; skin hydration; TEWL/skin barrier; facial imaging; 4-week durability/regression.

**Why it matters:** It captures dose, duration, washout/regression follow-up, and skin-density endpoints for a direct collagen-peptide trial.

**Potential experiment signals:** 5 g/day, skin thickness, skin density, firmness, hydration, TEWL, washout/regression.

**Protocol takeaway:** Use as registry context only; cite the paired publication separately when extracted.

**Claim use:** `context-only`.
