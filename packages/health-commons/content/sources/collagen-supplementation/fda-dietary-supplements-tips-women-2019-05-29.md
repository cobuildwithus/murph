---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-dietary-supplements-tips-women-2019-05-29
slug: sources/collagen-supplementation/fda-dietary-supplements-tips-women-2019-05-29
title: 'FDA Dietary Supplements: Tips for Women'
summary: FDA consumer guidance notes supplements are not for treating disease and highlights clinician discussion before use in pregnancy, breastfeeding, or children.
status: draft
quality: usable
aliases:
- FDA supplement tips women
- supplements children pregnancy breastfeeding
categories:
- collagen-supplementation
- safety-quality-contaminants
- safety_boundary
- safety-only
relations:
-
  type: related_protocol
  target: protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides
-
  type: parent_family
  target: experiment_family:collagen-supplementation
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://www.fda.gov/food/information-consumers-using-dietary-supplements/dietary-supplements-tips-women
  canonicalUrl: https://www.fda.gov/food/information-consumers-using-dietary-supplements/dietary-supplements-tips-women
  identityAliases:
  - FDA supplement tips women
  - supplements children pregnancy breastfeeding
  - 'FDA Dietary Supplements: Tips for Women'
source:
  kind: web_page
  title: 'FDA Dietary Supplements: Tips for Women'
  authors: U.S. Food and Drug Administration
  year: 2019
  url: https://www.fda.gov/food/information-consumers-using-dietary-supplements/dietary-supplements-tips-women
  citation: 'U.S. Food and Drug Administration. Dietary Supplements: Tips for Women. Content current as of 2019-05-29.'
researchEvidence:
  designKind: guideline
  designLabel: FDA consumer guidance
  populationLabel: Safety-boundary context; not direct HCP efficacy evidence.
  aggregateRole: context
evidenceBucket: safety-quality-contaminants
whyItMatters: FDA consumer guidance notes supplements are not for treating disease and highlights clinician discussion before use in pregnancy, breastfeeding, or children.
potentialMurphEndpoints:
- safety_screen
- product_quality
- stop_conditions
protocolTakeaway: Use for the non-treatment disclaimer and for pregnancy, breastfeeding, and child/adolescent clinician-guidance boundaries.
murphTakeaway: Use for the non-treatment disclaimer and for pregnancy, breastfeeding, and child/adolescent clinician-guidance boundaries.
studyDesign: guidance_document
modality: safety_quality
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: safety-quality-contaminants
  directness: safety_boundary
  claimUse: safety-only
  priority: high
  batchId: safety-qa-addendum
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

# FDA Dietary Supplements: Tips for Women

Safety-only source page added by the final landing reducer to satisfy Safety QA blocker coverage for Hydrolyzed Collagen Peptides. It supports screening, product-quality, population-boundary, or stop-condition language and does not add a new efficacy claim.

## Landing use

Use for the non-treatment disclaimer and for pregnancy, breastfeeding, and child/adolescent clinician-guidance boundaries.

## Traceability

- Stable source key: `source_artifact:fda-dietary-supplements-tips-women-2019-05-29`
- Final reducer batch marker: `safety-qa-addendum`
- Source-extraction run: no; this addendum is not counted as a source-extraction batch.
- Artifact handling: metadata/source page only; no copyrighted PDF is committed.
