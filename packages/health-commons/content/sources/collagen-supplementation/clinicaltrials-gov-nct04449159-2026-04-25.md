---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct04449159-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct04449159-2026-04-25
title: Vinh Wellness Collagen on Skin Health
summary: Completed ClinicalTrials.gov registry for freshwater/marine hydrolyzed collagen and skin health; no results posted in the registry record.
status: draft
quality: usable
aliases:
- Vinh Wellness Collagen on Skin Health
- NCT04449159
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
    registryId: NCT04449159
    url: https://clinicaltrials.gov/study/NCT04449159
  canonicalUrl: https://clinicaltrials.gov/study/NCT04449159
  identityAliases:
  - Vinh Wellness Collagen on Skin Health
  - NCT04449159
source:
  kind: web_page
  title: Vinh Wellness Collagen on Skin Health
  authors: Vinh Hoan Corporation; KGK Science Inc. (collaborator)
  citation: ClinicalTrials.gov. NCT04449159. Efficacy of Vinh Wellness Collagen on Skin Health. First posted 26 Jun 2020; last updated 22 Jul 2020.
  year: 2020
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT04449159
researchEvidence:
  designKind: other
  designLabel: Completed randomized triple-/quadruple-blind placebo-controlled parallel trial registry
  populationLabel: Healthy women aged 45-60 years with visible signs of natural/photoaging.
  durationLabel: 12 weeks
  cohortKey: cohort:registry-direct-skin-aging
  participantCount: 50
  participantCountKind: approximate
  aggregateRole: primary
evidenceBucket: skin-aging
whyItMatters: It links a hydrolyzed-collagen skin-health product to objective elasticity, hydration, wrinkle, and lab-safety endpoints.
potentialMurphEndpoints:
- Cutometer R2/R5/R7
- Corneometer hydration
- VISIA wrinkles
- CBC
- AST/ALT
- creatinine/eGFR
protocolTakeaway: Use as registry context and publication-matching support only; do not cite registry alone for results.
murphTakeaway: For skin experiments, combine subjective ratings with objective proxies where possible; registry includes multiple safety labs not feasible in casual self-tracking.
studyDesign: rct
modality: oral hydrolyzed pangasius-skin collagen
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

**Findings:** Registry maps Vinh Wellness Collagen endpoints and safety labs but does not itself report efficacy results. Endpoints captured: cheek skin elasticity; underarm skin elasticity; cheek hydration; nasolabial wrinkles; skin quality VAS; blood pressure; heart rate; CBC; liver/kidney chemistry.

**Why it matters:** It links a hydrolyzed-collagen skin-health product to objective elasticity, hydration, wrinkle, and lab-safety endpoints.

**Potential experiment signals:** Cutometer R2/R5/R7, Corneometer hydration, VISIA wrinkles, CBC, AST/ALT, creatinine/eGFR.

**Protocol takeaway:** Use as registry context and publication-matching support only; do not cite registry alone for results.

**Claim use:** `context-only`.
