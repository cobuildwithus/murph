---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-bulletproof-collagen-protein-recall-2018-01-25
slug: sources/collagen-supplementation/fda-bulletproof-collagen-protein-recall-2018-01-25
title: Bulletproof 360, Inc. Issues Allergy Alert on Undeclared Milk in Collagen Protein Dietary Supplement
summary: FDA posted a Bulletproof collagen protein recall for undeclared milk due to third-party ingredient mislabeling.
status: draft
quality: usable
aliases:
- Bulletproof 360, Inc. Issues Allergy Alert on Undeclared Milk in Collagen Protein Dietary Supplement
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
    url: https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/bulletproof-360-inc-issues-allergy-alert-undeclared-milk-collagen-protein-dietary-supplement
  canonicalUrl: https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/bulletproof-360-inc-issues-allergy-alert-undeclared-milk-collagen-protein-dietary-supplement
  identityAliases:
  - Bulletproof 360, Inc. Issues Allergy Alert on Undeclared Milk in Collagen Protein Dietary Supplement
source:
  kind: web_page
  title: Bulletproof 360, Inc. Issues Allergy Alert on Undeclared Milk in Collagen Protein Dietary Supplement
  authors: U.S. Food and Drug Administration; Bulletproof 360, Inc.
  citation: U.S. Food and Drug Administration. Bulletproof 360, Inc. Issues Allergy Alert on Undeclared Milk in Collagen Protein Dietary Supplement. Company announcement and FDA publish date January 25, 2018.
  year: 2018
  journal: FDA recall announcement
  url: https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/bulletproof-360-inc-issues-allergy-alert-undeclared-milk-collagen-protein-dietary-supplement
researchEvidence:
  designKind: other
  designLabel: FDA-posted company allergy recall for undeclared milk in collagen protein supplement
  populationLabel: One lot (#1017088) of Bulletproof Collagen Protein dietary supplement, 16-oz bag
  durationLabel: Recall notice dated January 25, 2018
  cohortKey: batch-009:fda-bulletproof-collagen-protein-recall-2018-01-25
  participantCount: 1
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: safety-quality-contaminants
whyItMatters: Shows that allergen risk may come from manufacturing/supply-chain errors, not just collagen source.
potentialMurphEndpoints:
- safety:undeclared-milk
- safety:allergen-recall
- safety:supply-chain-quality
protocolTakeaway: Use source_artifact:fda-bulletproof-collagen-protein-recall-2018-01-25 as official collagen-product allergen/supply-chain recall context only.
murphTakeaway: Supports lot-specific recall checks and allergen caution for sensitive users.
studyDesign: FDA-posted company allergy recall for undeclared milk in collagen protein supplement
modality: collagen protein supplement recall
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

**Findings:** Population/exposure: One lot (#1017088) of Bulletproof Collagen Protein dietary supplement, 16-oz bag Intervention or exposure: Bulletproof Collagen Protein dietary supplement lot #1017088. Comparator/control: No comparator. Duration/follow-up: Recall notice dated January 25, 2018 Endpoints: undeclared milk allergen, mislabeled bulk whey protein, affected lot, recall action. Direction/effect: FDA-posted notice stated the lot contained undeclared milk because bulk whey protein had been mislabeled as collagen protein by a third-party manufacturer. Safety notes: People with milk allergy or severe sensitivity were warned of serious or life-threatening allergic reaction risk if consumed. Limitations: Single lot recall.; Recall notice rather than clinical study.; Does not estimate incidence or reflect all collagen protein products.. Population mismatch: Product recall event rather than a user cohort.

**Why it matters:** Shows that allergen risk may come from manufacturing/supply-chain errors, not just collagen source.

**Potential experiment signals:** safety:undeclared-milk, safety:allergen-recall, safety:supply-chain-quality.

**Protocol takeaway:** Use source_artifact:fda-bulletproof-collagen-protein-recall-2018-01-25 as official collagen-product allergen/supply-chain recall context only.

**Claim use:** `safety-only`. Directness: `direct_protocol`. Rights status guess: `unknown`.
