---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-dietary-supplements-2024-02-21
slug: sources/collagen-supplementation/fda-dietary-supplements-2024-02-21
title: FDA Questions and Answers on Dietary Supplements
summary: FDA consumer guidance explains supplement oversight limits, manufacturer responsibility, label review, clinician consultation, and adverse-event reporting.
status: draft
quality: usable
aliases:
- dietary supplement FDA Q&A
- FDA supplement premarket oversight
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
    url: https://www.fda.gov/food/information-consumers-using-dietary-supplements/questions-and-answers-dietary-supplements
  canonicalUrl: https://www.fda.gov/food/information-consumers-using-dietary-supplements/questions-and-answers-dietary-supplements
  identityAliases:
  - dietary supplement FDA Q&A
  - FDA supplement premarket oversight
  - FDA Questions and Answers on Dietary Supplements
source:
  kind: web_page
  title: FDA Questions and Answers on Dietary Supplements
  authors: U.S. Food and Drug Administration
  year: 2024
  url: https://www.fda.gov/food/information-consumers-using-dietary-supplements/questions-and-answers-dietary-supplements
  citation: U.S. Food and Drug Administration. Questions and Answers on Dietary Supplements. Content current as of 2024-02-21.
researchEvidence:
  designKind: guideline
  designLabel: FDA consumer guidance
  populationLabel: Safety-boundary context; not direct HCP efficacy evidence.
  aggregateRole: context
evidenceBucket: safety-quality-contaminants
whyItMatters: FDA consumer guidance explains supplement oversight limits, manufacturer responsibility, label review, clinician consultation, and adverse-event reporting.
potentialMurphEndpoints:
- safety_screen
- product_quality
- stop_conditions
protocolTakeaway: Use FDA supplement guidance for the protocol disclaimer that supplements are not premarket-approved by FDA and for product identity, manufacturer, clinician-consultation, and adverse-event reporting guardrails.
murphTakeaway: Use FDA supplement guidance for the protocol disclaimer that supplements are not premarket-approved by FDA and for product identity, manufacturer, clinician-consultation, and adverse-event reporting guardrails.
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

# FDA Questions and Answers on Dietary Supplements

Safety-only source page added by the final landing reducer to satisfy Safety QA blocker coverage for Hydrolyzed Collagen Peptides. It supports screening, product-quality, population-boundary, or stop-condition language and does not add a new efficacy claim.

## Landing use

Use FDA supplement guidance for the protocol disclaimer that supplements are not premarket-approved by FDA and for product identity, manufacturer, clinician-consultation, and adverse-event reporting guardrails.

## Traceability

- Stable source key: `source_artifact:fda-dietary-supplements-2024-02-21`
- Final reducer batch marker: `safety-qa-addendum`
- Source-extraction run: no; this addendum is not counted as a source-extraction batch.
- Artifact handling: metadata/source page only; no copyrighted PDF is committed.
