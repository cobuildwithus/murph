---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:cdc-alpha-gal-managing-2026-01-05
slug: sources/collagen-supplementation/cdc-alpha-gal-managing-2026-01-05
title: CDC Managing Alpha-gal Syndrome
summary: CDC management guidance says people with alpha-gal syndrome should avoid mammal-derived exposures as needed and work with a healthcare provider.
status: draft
quality: usable
aliases:
- CDC alpha-gal management
- alpha-gal healthcare provider guidance
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
    url: https://www.cdc.gov/alpha-gal-syndrome/managing/index.html
  canonicalUrl: https://www.cdc.gov/alpha-gal-syndrome/managing/index.html
  identityAliases:
  - CDC alpha-gal management
  - alpha-gal healthcare provider guidance
  - CDC Managing Alpha-gal Syndrome
source:
  kind: web_page
  title: CDC Managing Alpha-gal Syndrome
  authors: Centers for Disease Control and Prevention
  year: 2026
  url: https://www.cdc.gov/alpha-gal-syndrome/managing/index.html
  citation: Centers for Disease Control and Prevention. Managing Alpha-gal Syndrome. Updated 2026-01-05.
researchEvidence:
  designKind: guideline
  designLabel: CDC public health guidance
  populationLabel: Safety-boundary context; not direct HCP efficacy evidence.
  aggregateRole: context
evidenceBucket: safety-quality-contaminants
whyItMatters: CDC management guidance says people with alpha-gal syndrome should avoid mammal-derived exposures as needed and work with a healthcare provider.
potentialMurphEndpoints:
- safety_screen
- product_quality
- stop_conditions
protocolTakeaway: Use for the clinician/allergist-clearance requirement before alpha-gal users try mammalian-source or source-unclear collagen products.
murphTakeaway: Use for the clinician/allergist-clearance requirement before alpha-gal users try mammalian-source or source-unclear collagen products.
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

# CDC Managing Alpha-gal Syndrome

Safety-only source page added by the final landing reducer to satisfy Safety QA blocker coverage for Hydrolyzed Collagen Peptides. It supports screening, product-quality, population-boundary, or stop-condition language and does not add a new efficacy claim.

## Landing use

Use for the clinician/allergist-clearance requirement before alpha-gal users try mammalian-source or source-unclear collagen products.

## Traceability

- Stable source key: `source_artifact:cdc-alpha-gal-managing-2026-01-05`
- Final reducer batch marker: `safety-qa-addendum`
- Source-extraction run: no; this addendum is not counted as a source-extraction batch.
- Artifact handling: metadata/source page only; no copyrighted PDF is committed.
