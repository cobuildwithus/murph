---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:cdc-alpha-gal-products-2026-01-05
slug: sources/collagen-supplementation/cdc-alpha-gal-products-2026-01-05
title: 'CDC Fast Facts: Products That May Contain Alpha-gal'
summary: CDC alpha-gal guidance identifies mammalian-source ingredients, including beef/pork gelatin and some additives, as possible exposure concerns.
status: draft
quality: usable
aliases:
- CDC alpha-gal products
- alpha-gal gelatin additives
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
    url: https://www.cdc.gov/alpha-gal-syndrome/products-that-contain-alpha-gal/index.html
  canonicalUrl: https://www.cdc.gov/alpha-gal-syndrome/products-that-contain-alpha-gal/index.html
  identityAliases:
  - CDC alpha-gal products
  - alpha-gal gelatin additives
  - 'CDC Fast Facts: Products That May Contain Alpha-gal'
source:
  kind: web_page
  title: 'CDC Fast Facts: Products That May Contain Alpha-gal'
  authors: Centers for Disease Control and Prevention
  year: 2026
  url: https://www.cdc.gov/alpha-gal-syndrome/products-that-contain-alpha-gal/index.html
  citation: 'Centers for Disease Control and Prevention. Fast Facts: Products That May Contain Alpha-gal. Updated 2026-01-05.'
researchEvidence:
  designKind: guideline
  designLabel: CDC public health guidance
  populationLabel: Safety-boundary context; not direct HCP efficacy evidence.
  aggregateRole: context
evidenceBucket: safety-quality-contaminants
whyItMatters: CDC alpha-gal guidance identifies mammalian-source ingredients, including beef/pork gelatin and some additives, as possible exposure concerns.
potentialMurphEndpoints:
- safety_screen
- product_quality
- stop_conditions
protocolTakeaway: Use for alpha-gal and mammalian-source screening around bovine/porcine collagen, gelatin, capsules, and mammal-derived excipients.
murphTakeaway: Use for alpha-gal and mammalian-source screening around bovine/porcine collagen, gelatin, capsules, and mammal-derived excipients.
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

# CDC Fast Facts: Products That May Contain Alpha-gal

Safety-only source page added by the final landing reducer to satisfy Safety QA blocker coverage for Hydrolyzed Collagen Peptides. It supports screening, product-quality, population-boundary, or stop-condition language and does not add a new efficacy claim.

## Landing use

Use for alpha-gal and mammalian-source screening around bovine/porcine collagen, gelatin, capsules, and mammal-derived excipients.

## Traceability

- Stable source key: `source_artifact:cdc-alpha-gal-products-2026-01-05`
- Final reducer batch marker: `safety-qa-addendum`
- Source-extraction run: no; this addendum is not counted as a source-extraction batch.
- Artifact handling: metadata/source page only; no copyrighted PDF is committed.
