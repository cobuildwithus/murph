---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:adam-collagen-calcitonin-1998
slug: sources/collagen-supplementation/adam-collagen-calcitonin-1998
title: May Collagen Hydrolysate Rich Diet (CHRD) Extend the Effect of Calcitonin in Postmenopausal Osteoporosis?
summary: Historical calcitonin-plus-collagen-diet source is too confounded for direct HCP claims without full text.
status: draft
quality: usable
aliases:
- May Collagen Hydrolysate Rich Diet (CHRD) Extend the Effect of Calcitonin in Postmenopausal Osteoporosis?
- Adam 1998 collagen hydrolysate rich diet calcitonin osteoporosis
categories:
- collagen-supplementation
- bone-density-turnover
- adjacent_variant
- context-only
relations:
-
  type: related_protocol
  target: protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides
-
  type: parent_family
  target: experiment_family:collagen-supplementation
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: title_hash
  identifiers:
    titleHash: 496e8ae8514f942ede97d0f16e0e332e952b01467b9552ec9f6eadc7cff209fd
  identityAliases:
  - May Collagen Hydrolysate Rich Diet (CHRD) Extend the Effect of Calcitonin in Postmenopausal Osteoporosis?
  - Adam 1998 collagen hydrolysate rich diet calcitonin osteoporosis
source:
  kind: journal_article
  title: May Collagen Hydrolysate Rich Diet (CHRD) Extend the Effect of Calcitonin in Postmenopausal Osteoporosis?
  authors: M Adam; P Špaček; H Hulejová; A Galiánová; J Blahoš
  citation: Adam M, Špaček P, Hulejová H, Galiánová A, Blahoš J. May Collagen Hydrolysate Rich Diet (CHRD) Extend the Effect of Calcitonin in Postmenopausal Osteoporosis? Connective Tissue Diseases. 1998;17:25-36. No DOI/PMID identified in batch records.
  year: 1998
  journal: Connective Tissue Diseases
researchEvidence:
  designKind: controlled_trial
  designLabel: Historical controlled trial/reference; full extraction unavailable
  populationLabel: Postmenopausal osteoporosis patients; detailed eligibility not extracted.
  durationLabel: Unknown/not extracted.
  cohortKey: collagen-bone-batch-008-adam-collagen-calcitonin-1998
  aggregateRole: context
evidenceBucket: bone-density-turnover
whyItMatters: It is often surfaced in collagen-bone discussions but is heavily confounded and poorly accessible.
potentialMurphEndpoints:
- calcitonin co-treatment
- collagen-rich diet
- BMD/markers if retrieved
protocolTakeaway: Context-only historical citation; do not use for HCP-alone claims.
murphTakeaway: Medication-supervised osteoporosis treatment should not be collapsed into over-the-counter collagen supplementation.
studyDesign: Historical controlled trial/reference; full extraction unavailable
modality: collagen-rich diet adjunct to calcitonin
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: bone-density-turnover
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  batchId: batch-008
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **bone-density-turnover**.

**Findings:**

- **Population:** Postmenopausal osteoporosis patients; detailed eligibility not extracted.
- **Intervention/exposure:** Collagen hydrolysate rich diet as adjunct to calcitonin; dose/duration not verified from primary source.
- **Comparator/control:** Calcitonin without collagen-rich diet; details not verified.
- **Duration/follow-up:** Unknown/not extracted.
- **Endpoints:** bone mineral density, bone metabolism markers.
- **Effect/direction:** Effect direction not extracted from primary source; likely overlaps historical calcitonin-collagen program but should not be used without full-text verification.
- **Adverse events/safety:** Not extracted.
- **Limitations:** No DOI/PMID in batch record; hard retrieval.; Calcitonin medication confounding.; Diet rich in collagen proteins is not identical to standardized HCP supplement.; Sample size and endpoint details not extracted.
- **Population mismatch/directness:** Clinical medication adjunct and diet context; adjacent to HCP protocol.

**Why it matters:** It is often surfaced in collagen-bone discussions but is heavily confounded and poorly accessible.

**Potential experiment signals:** calcitonin co-treatment, collagen-rich diet, BMD/markers if retrieved.

**Protocol takeaway:** Context-only historical citation; do not use for HCP-alone claims.

**Claim use:** `context-only`.

**Artifact candidates and rights:** `unknown`. Do not place copyrighted PDFs in Git; preserve metadata/source-page draft unless rights are clearly open and redistributable.
