---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct07516756-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct07516756-2026-04-25
title: 'Effect of Collagen Peptides on Skin Health: A Clinical Trial'
summary: Newly posted ClinicalTrials.gov registry/protocol for 2.5 g/day specific bioactive collagen peptides over 8 weeks; no peer-reviewed results in this source.
status: draft
quality: usable
aliases:
- 'Effect of Collagen Peptides on Skin Health: A Clinical Trial'
- NCT07516756
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
    registryId: NCT07516756
    url: https://clinicaltrials.gov/study/NCT07516756
  canonicalUrl: https://clinicaltrials.gov/study/NCT07516756
  identityAliases:
  - 'Effect of Collagen Peptides on Skin Health: A Clinical Trial'
  - NCT07516756
source:
  kind: web_page
  title: 'Effect of Collagen Peptides on Skin Health: A Clinical Trial'
  authors: Collagen Research Institute; GELITA (collaborator)
  citation: 'ClinicalTrials.gov. NCT07516756. Effect of Collagen Peptides on Skin Health: A Clinical Trial. First posted 8 Apr 2026; last updated 8 Apr 2026.'
  year: 2026
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT07516756
researchEvidence:
  designKind: other
  designLabel: Completed randomized double-blind placebo-controlled trial registry
  populationLabel: Healthy adult women aged 35-55 years.
  durationLabel: 8 weeks
  cohortKey: cohort:registry-direct-skin-aging
  participantCount: 66
  participantCountKind: approximate
  aggregateRole: primary
evidenceBucket: skin-aging
whyItMatters: It is a recent direct-protocol registry with clear primary and secondary skin endpoints.
potentialMurphEndpoints:
- stratum corneum hydration
- TEWL
- R2/R5 elasticity
- firmness
- collagen content
- 3D wrinkle morphology
- adverse events
protocolTakeaway: Use for registry and endpoint context only; add results only after publication/results tables are extracted.
murphTakeaway: A structured 8-week experiment should predefine hydration, TEWL/barrier, elasticity, and wrinkle measures before starting.
studyDesign: rct
modality: oral specific bioactive collagen peptides
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: permission_required
ledgerClassification:
  evidenceBucket: skin-aging
  directness: direct_protocol
  claimUse: context-only
  priority: medium
  batchId: batch-005
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: permission_required
---

This source is included for **skin-aging**.

**Findings:** Direct 2.5 g/day collagen-peptide registry with hydration primary endpoint; results not posted. Endpoints captured: stratum corneum hydration; TEWL; skin elasticity; skin firmness; dermal collagen content; periorbital wrinkle morphology; subjective skin assessment; adverse events.

**Why it matters:** It is a recent direct-protocol registry with clear primary and secondary skin endpoints.

**Potential experiment signals:** stratum corneum hydration, TEWL, R2/R5 elasticity, firmness, collagen content, 3D wrinkle morphology, adverse events.

**Protocol takeaway:** Use for registry and endpoint context only; add results only after publication/results tables are extracted.

**Claim use:** `context-only`.
