---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:consumerlab-vital-proteins-collagen-recall-2023-06-12
slug: sources/collagen-supplementation/consumerlab-vital-proteins-collagen-recall-2023-06-12
title: Vital Proteins Collagen Peptides 24 oz Recalled
summary: A recall notice reported a single-batch Vital Proteins collagen peptide recall due to possible broken blue plastic pieces in canisters.
status: draft
quality: usable
aliases:
- Vital Proteins Collagen Peptides 24 oz Recalled
categories:
- collagen-supplementation
- safety-quality-contaminants
- direct_protocol
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
    url: https://www.consumerlab.com/recalls/14752/vital-proteins-collagen-peptides-24-oz-recalled/
  canonicalUrl: https://www.consumerlab.com/recalls/14752/vital-proteins-collagen-peptides-24-oz-recalled/
  identityAliases:
  - Vital Proteins Collagen Peptides 24 oz Recalled
source:
  kind: web_page
  title: Vital Proteins Collagen Peptides 24 oz Recalled
  authors: ConsumerLab.com
  citation: ConsumerLab.com. Vital Proteins Collagen Peptides 24 oz Recalled. Posted June 12, 2023.
  year: 2023
  journal: ConsumerLab.com recall notice
  url: https://www.consumerlab.com/recalls/14752/vital-proteins-collagen-peptides-24-oz-recalled/
researchEvidence:
  designKind: other
  designLabel: Commercial recall notice summarizing single-batch collagen product recall
  populationLabel: Single batch of Vital Proteins Collagen Peptides – Unflavored (24 oz) distributed to and sold by Costco
  durationLabel: Recall initiated April 28, 2023; notice posted June 12, 2023
  cohortKey: batch-009:consumerlab-vital-proteins-collagen-recall-2023-06-12
  participantCount: 1
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: safety-quality-contaminants
whyItMatters: Direct collagen-peptide product-quality boundary showing lot-level manufacturing/packaging events can matter.
potentialMurphEndpoints:
- safety:foreign-material
- safety:product-recall
- safety:lot-quality
protocolTakeaway: Use source_artifact:consumerlab-vital-proteins-collagen-recall-2023-06-12 as direct product-quality recall context only.
murphTakeaway: Supports checking batch/recall status and not assuming brand-level uniformity.
studyDesign: Commercial recall notice summarizing single-batch collagen product recall
modality: collagen peptide product recall notice
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: safety-quality-contaminants
  directness: direct_protocol
  claimUse: safety-only
  priority: high
  batchId: batch-009
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **safety-quality-contaminants**.

**Findings:** Population/exposure: Single batch of Vital Proteins Collagen Peptides – Unflavored (24 oz) distributed to and sold by Costco Intervention or exposure: Vital Proteins Collagen Peptides – Unflavored (24 oz), batch code 30095993HA, best by 01-09-2028. Comparator/control: No comparator. Duration/follow-up: Recall initiated April 28, 2023; notice posted June 12, 2023 Endpoints: foreign material contamination, broken plastic pieces, injury reports, recall action. Direction/effect: ConsumerLab reported that canisters may contain broken blue plastic pieces from a broken lid and that no injuries had been reported to date. Safety notes: Potential foreign-material contamination; no injuries reported in the notice. Limitations: Recall notice rather than clinical study.; Single batch/product; does not characterize all Vital Proteins products or all collagen peptides.; ConsumerLab notice should be cross-checked with primary recall documents for formal regulatory claims.. Population mismatch: Product recall event, not clinical users.

**Why it matters:** Direct collagen-peptide product-quality boundary showing lot-level manufacturing/packaging events can matter.

**Potential experiment signals:** safety:foreign-material, safety:product-recall, safety:lot-quality.

**Protocol takeaway:** Use source_artifact:consumerlab-vital-proteins-collagen-recall-2023-06-12 as direct product-quality recall context only.

**Claim use:** `safety-only`. Directness: `direct_protocol`. Rights status guess: `unknown`.
