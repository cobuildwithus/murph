---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:hsa-biotin-clinical-lab-tests-2019-09-13
slug: sources/collagen-supplementation/hsa-biotin-clinical-lab-tests-2019-09-13
title: HSA Biotin interference with clinical laboratory tests
summary: Singapore HSA safety alert explains that biotin can significantly interfere with some clinical lab tests and cause false high or false low results.
status: draft
quality: usable
aliases:
- HSA biotin lab interference
- Singapore biotin lab tests
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
    url: https://www.hsa.gov.sg/announcements/safety-alert/biotin-interference-with-clinical-laboratory-tests
  canonicalUrl: https://www.hsa.gov.sg/announcements/safety-alert/biotin-interference-with-clinical-laboratory-tests
  identityAliases:
  - HSA biotin lab interference
  - Singapore biotin lab tests
  - HSA Biotin interference with clinical laboratory tests
source:
  kind: web_page
  title: HSA Biotin interference with clinical laboratory tests
  authors: Health Sciences Authority Singapore
  year: 2019
  url: https://www.hsa.gov.sg/announcements/safety-alert/biotin-interference-with-clinical-laboratory-tests
  citation: Health Sciences Authority Singapore. Biotin interference with clinical laboratory tests. Published 2019-09-13.
researchEvidence:
  designKind: guideline
  designLabel: Safety alert
  populationLabel: Safety-boundary context; not direct HCP efficacy evidence.
  aggregateRole: context
evidenceBucket: safety-quality-contaminants
whyItMatters: Singapore HSA safety alert explains that biotin can significantly interfere with some clinical lab tests and cause false high or false low results.
potentialMurphEndpoints:
- safety_screen
- product_quality
- stop_conditions
protocolTakeaway: Use as additional lab-interference context for users of biotin-containing collagen or beauty blends; pause and follow lab or clinician instructions before relevant testing.
murphTakeaway: Use as additional lab-interference context for users of biotin-containing collagen or beauty blends; pause and follow lab or clinician instructions before relevant testing.
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

# HSA Biotin interference with clinical laboratory tests

Safety-only source page added by the final landing reducer to satisfy Safety QA blocker coverage for Hydrolyzed Collagen Peptides. It supports screening, product-quality, population-boundary, or stop-condition language and does not add a new efficacy claim.

## Landing use

Use as additional lab-interference context for users of biotin-containing collagen or beauty blends; pause and follow lab or clinician instructions before relevant testing.

## Traceability

- Stable source key: `source_artifact:hsa-biotin-clinical-lab-tests-2019-09-13`
- Final reducer batch marker: `safety-qa-addendum`
- Source-extraction run: no; this addendum is not counted as a source-extraction batch.
- Artifact handling: metadata/source page only; no copyrighted PDF is committed.
