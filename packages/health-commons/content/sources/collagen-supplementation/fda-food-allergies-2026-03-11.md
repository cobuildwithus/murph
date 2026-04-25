---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-food-allergies-2026-03-11
slug: sources/collagen-supplementation/fda-food-allergies-2026-03-11
title: FDA Food Allergies
summary: FDA food-allergy guidance lists major allergens including fish and Crustacean shellfish and notes labeling and cross-contact issues.
status: draft
quality: usable
aliases:
- FDA food allergy guidance
- major food allergens
- fish shellfish allergen labeling
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
    url: https://www.fda.gov/food/food-labeling-nutrition/food-allergies
  canonicalUrl: https://www.fda.gov/food/food-labeling-nutrition/food-allergies
  identityAliases:
  - FDA food allergy guidance
  - major food allergens
  - fish shellfish allergen labeling
  - FDA Food Allergies
source:
  kind: web_page
  title: FDA Food Allergies
  authors: U.S. Food and Drug Administration
  year: 2026
  url: https://www.fda.gov/food/food-labeling-nutrition/food-allergies
  citation: U.S. Food and Drug Administration. Food Allergies. Content current as of 2026-03-11.
researchEvidence:
  designKind: guideline
  designLabel: FDA consumer guidance
  populationLabel: Safety-boundary context; not direct HCP efficacy evidence.
  aggregateRole: context
evidenceBucket: safety-quality-contaminants
whyItMatters: FDA food-allergy guidance lists major allergens including fish and Crustacean shellfish and notes labeling and cross-contact issues.
potentialMurphEndpoints:
- safety_screen
- product_quality
- stop_conditions
protocolTakeaway: Use this for fish, Crustacean-shellfish, allergen-label, and cross-contact screening language; it is safety-boundary evidence, not HCP efficacy evidence.
murphTakeaway: Use this for fish, Crustacean-shellfish, allergen-label, and cross-contact screening language; it is safety-boundary evidence, not HCP efficacy evidence.
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

# FDA Food Allergies

Safety-only source page added by the final landing reducer to satisfy Safety QA blocker coverage for Hydrolyzed Collagen Peptides. It supports screening, product-quality, population-boundary, or stop-condition language and does not add a new efficacy claim.

## Landing use

Use this for fish, Crustacean-shellfish, allergen-label, and cross-contact screening language; it is safety-boundary evidence, not HCP efficacy evidence.

## Traceability

- Stable source key: `source_artifact:fda-food-allergies-2026-03-11`
- Final reducer batch marker: `safety-qa-addendum`
- Source-extraction run: no; this addendum is not counted as a source-extraction batch.
- Artifact handling: metadata/source page only; no copyrighted PDF is committed.
