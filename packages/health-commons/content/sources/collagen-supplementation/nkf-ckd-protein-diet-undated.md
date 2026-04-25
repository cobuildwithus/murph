---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nkf-ckd-protein-diet-undated
slug: sources/collagen-supplementation/nkf-ckd-protein-diet-undated
title: 'National Kidney Foundation CKD Diet: How much protein is the right amount?'
summary: NKF patient guidance says protein needs differ by kidney status and dialysis status and should be individualized with a clinician or dietitian.
status: draft
quality: usable
aliases:
- NKF CKD protein diet
- kidney protein restriction
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
    url: https://www.kidney.org/kidney-topics/ckd-diet-how-much-protein-right-amount
  canonicalUrl: https://www.kidney.org/kidney-topics/ckd-diet-how-much-protein-right-amount
  identityAliases:
  - NKF CKD protein diet
  - kidney protein restriction
  - 'National Kidney Foundation CKD Diet: How much protein is the right amount?'
source:
  kind: web_page
  title: 'National Kidney Foundation CKD Diet: How much protein is the right amount?'
  authors: National Kidney Foundation
  url: https://www.kidney.org/kidney-topics/ckd-diet-how-much-protein-right-amount
  citation: 'National Kidney Foundation. CKD Diet: How much protein is the right amount? Undated page accessed during 2026-04-25 landing reducer.'
researchEvidence:
  designKind: guideline
  designLabel: Patient guidance
  populationLabel: Safety-boundary context; not direct HCP efficacy evidence.
  aggregateRole: context
evidenceBucket: safety-quality-contaminants
whyItMatters: NKF patient guidance says protein needs differ by kidney status and dialysis status and should be individualized with a clinician or dietitian.
potentialMurphEndpoints:
- safety_screen
- product_quality
- stop_conditions
protocolTakeaway: Use for conservative kidney/protein-restriction screening and the reminder that collagen counts as protein exposure but is not a clinician-directed protein plan.
murphTakeaway: Use for conservative kidney/protein-restriction screening and the reminder that collagen counts as protein exposure but is not a clinician-directed protein plan.
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

# National Kidney Foundation CKD Diet: How much protein is the right amount?

Safety-only source page added by the final landing reducer to satisfy Safety QA blocker coverage for Hydrolyzed Collagen Peptides. It supports screening, product-quality, population-boundary, or stop-condition language and does not add a new efficacy claim.

## Landing use

Use for conservative kidney/protein-restriction screening and the reminder that collagen counts as protein exposure but is not a clinician-directed protein plan.

## Traceability

- Stable source key: `source_artifact:nkf-ckd-protein-diet-undated`
- Final reducer batch marker: `safety-qa-addendum`
- Source-extraction run: no; this addendum is not counted as a source-extraction batch.
- Artifact handling: metadata/source page only; no copyrighted PDF is committed.
