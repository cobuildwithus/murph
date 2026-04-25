---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-medicine-pregnancy-2025-02-03
slug: sources/collagen-supplementation/fda-medicine-pregnancy-2025-02-03
title: FDA Medicine and Pregnancy
summary: FDA pregnancy guidance advises discussing medicines, vitamins, and dietary supplements with a healthcare provider during pregnancy and breastfeeding contexts.
status: draft
quality: usable
aliases:
- FDA medicine pregnancy supplements
- pregnancy supplement guidance
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
    url: https://www.fda.gov/consumers/free-publications-women/medicine-and-pregnancy
  canonicalUrl: https://www.fda.gov/consumers/free-publications-women/medicine-and-pregnancy
  identityAliases:
  - FDA medicine pregnancy supplements
  - pregnancy supplement guidance
  - FDA Medicine and Pregnancy
source:
  kind: web_page
  title: FDA Medicine and Pregnancy
  authors: U.S. Food and Drug Administration
  year: 2025
  url: https://www.fda.gov/consumers/free-publications-women/medicine-and-pregnancy
  citation: U.S. Food and Drug Administration. Medicine and Pregnancy. Content current as of 2025-02-03.
researchEvidence:
  designKind: guideline
  designLabel: FDA consumer guidance
  populationLabel: Safety-boundary context; not direct HCP efficacy evidence.
  aggregateRole: context
evidenceBucket: safety-quality-contaminants
whyItMatters: FDA pregnancy guidance advises discussing medicines, vitamins, and dietary supplements with a healthcare provider during pregnancy and breastfeeding contexts.
potentialMurphEndpoints:
- safety_screen
- product_quality
- stop_conditions
protocolTakeaway: Use to route pregnancy, trying to conceive, and breastfeeding contexts to clinician guidance before unsupervised supplement use.
murphTakeaway: Use to route pregnancy, trying to conceive, and breastfeeding contexts to clinician guidance before unsupervised supplement use.
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

# FDA Medicine and Pregnancy

Safety-only source page added by the final landing reducer to satisfy Safety QA blocker coverage for Hydrolyzed Collagen Peptides. It supports screening, product-quality, population-boundary, or stop-condition language and does not add a new efficacy claim.

## Landing use

Use to route pregnancy, trying to conceive, and breastfeeding contexts to clinician guidance before unsupervised supplement use.

## Traceability

- Stable source key: `source_artifact:fda-medicine-pregnancy-2025-02-03`
- Final reducer batch marker: `safety-qa-addendum`
- Source-extraction run: no; this addendum is not counted as a source-extraction batch.
- Artifact handling: metadata/source page only; no copyrighted PDF is committed.
