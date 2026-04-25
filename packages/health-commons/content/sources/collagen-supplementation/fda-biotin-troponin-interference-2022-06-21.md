---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-biotin-troponin-interference-2022-06-21
slug: sources/collagen-supplementation/fda-biotin-troponin-interference-2022-06-21
title: FDA Biotin Interference with Troponin Lab Tests
summary: FDA safety communication warns that biotin can interfere with some lab tests, including troponin assays, and can produce incorrect results.
status: draft
quality: usable
aliases:
- FDA biotin lab test interference
- biotin troponin interference
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
    url: https://www.fda.gov/medical-devices/safety-communications/update-fda-warns-biotin-may-interfere-lab-tests-fda-safety-communication
  canonicalUrl: https://www.fda.gov/medical-devices/safety-communications/update-fda-warns-biotin-may-interfere-lab-tests-fda-safety-communication
  identityAliases:
  - FDA biotin lab test interference
  - biotin troponin interference
  - FDA Biotin Interference with Troponin Lab Tests
source:
  kind: web_page
  title: FDA Biotin Interference with Troponin Lab Tests
  authors: U.S. Food and Drug Administration
  year: 2022
  url: https://www.fda.gov/medical-devices/safety-communications/update-fda-warns-biotin-may-interfere-lab-tests-fda-safety-communication
  citation: 'U.S. Food and Drug Administration. Update: The FDA Warns that Biotin May Interfere with Lab Tests. Content current as of 2022-06-21.'
researchEvidence:
  designKind: guideline
  designLabel: FDA safety communication
  populationLabel: Safety-boundary context; not direct HCP efficacy evidence.
  aggregateRole: context
evidenceBucket: safety-quality-contaminants
whyItMatters: FDA safety communication warns that biotin can interfere with some lab tests, including troponin assays, and can produce incorrect results.
potentialMurphEndpoints:
- safety_screen
- product_quality
- stop_conditions
protocolTakeaway: Use for lab-test pause guidance when a collagen or beauty product contains biotin, especially around cardiac/troponin and other assay contexts.
murphTakeaway: Use for lab-test pause guidance when a collagen or beauty product contains biotin, especially around cardiac/troponin and other assay contexts.
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

# FDA Biotin Interference with Troponin Lab Tests

Safety-only source page added by the final landing reducer to satisfy Safety QA blocker coverage for Hydrolyzed Collagen Peptides. It supports screening, product-quality, population-boundary, or stop-condition language and does not add a new efficacy claim.

## Landing use

Use for lab-test pause guidance when a collagen or beauty product contains biotin, especially around cardiac/troponin and other assay contexts.

## Traceability

- Stable source key: `source_artifact:fda-biotin-troponin-interference-2022-06-21`
- Final reducer batch marker: `safety-qa-addendum`
- Source-extraction run: no; this addendum is not counted as a source-extraction batch.
- Artifact handling: metadata/source page only; no copyrighted PDF is committed.
