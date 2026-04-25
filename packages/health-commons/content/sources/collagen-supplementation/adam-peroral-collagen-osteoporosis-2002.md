---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:adam-peroral-collagen-osteoporosis-2002
slug: sources/collagen-supplementation/adam-peroral-collagen-osteoporosis-2002
title: What is the effect of collagen peptides peroral administration in postmenopausal osteoporosis
summary: Older 3-year controlled trial suggests biomarker changes with 10 g/day collagen peptides, but retrieval and attrition limit confidence.
status: draft
quality: usable
aliases:
- What is the effect of collagen peptides peroral administration in postmenopausal osteoporosis
- Long-term follow-up of indicators of bone metabolism in female patients with osteoporosis treated with calcium and collagen peptides
- Adam 2002 Ceska Revmatologie collagen peptides osteoporosis
categories:
- collagen-supplementation
- bone-density-turnover
- direct_protocol
- supports-protocol
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
    titleHash: 4f4de342fb8b1899f2bfbb7a0758506b6cd2f46a086af942b44947becf79be24
  identityAliases:
  - What is the effect of collagen peptides peroral administration in postmenopausal osteoporosis
  - Long-term follow-up of indicators of bone metabolism in female patients with osteoporosis treated with calcium and collagen peptides
  - Adam 2002 Ceska Revmatologie collagen peptides osteoporosis
source:
  kind: journal_article
  title: What is the effect of collagen peptides peroral administration in postmenopausal osteoporosis
  authors: M Adam; P Špaček; H Hulejová
  citation: Adam M, Špaček P, Hulejová H. What is the effect of collagen peptides peroral administration in postmenopausal osteoporosis. Ces. Revmatol. 2002;10(3):131-137. Bibliographic details from secondary indexed abstract; no DOI/PMID identified.
  year: 2002
  journal: Česká revmatologie / Ces. Revmatol.
researchEvidence:
  designKind: controlled_trial
  designLabel: Older randomized controlled comparison reported in secondary abstract
  populationLabel: Women with postmenopausal osteoporosis and BMD below 80% of premenopausal reference values in the accessible abstract.
  durationLabel: 3 years with 6-month follow-up visits; baseline and end-of-study marker comparison.
  cohortKey: collagen-bone-batch-008-adam-peroral-collagen-osteoporosis-2002
  participantCount: 120
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: bone-density-turnover
whyItMatters: It is one of the few older HCP-alone osteoporosis sources, but its accessibility and attrition require explicit caution.
potentialMurphEndpoints:
- urinary pyridinoline
- deoxypyridinoline
- bone alkaline phosphatase
- osteocalcin
- dropout rate
protocolTakeaway: Mention only as uncertain historical direct evidence; avoid strong BMD or fracture claims.
murphTakeaway: Long follow-up and attrition matter; biomarker-only changes are not the same as fracture-risk reduction.
studyDesign: Older randomized controlled comparison reported in secondary abstract
modality: oral collagen peptides
claimUse: supports-protocol
murphV1Priority: High
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: bone-density-turnover
  directness: direct_protocol
  claimUse: supports-protocol
  priority: high
  batchId: batch-008
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **bone-density-turnover**.

**Findings:**

- **Population:** Women with postmenopausal osteoporosis and BMD below 80% of premenopausal reference values in the accessible abstract.
- **Intervention/exposure:** 10 g/day oral collagen peptides for up to 3 years.
- **Comparator/control:** 500 mg/day calcium gluconate.
- **Duration/follow-up:** 3 years with 6-month follow-up visits; baseline and end-of-study marker comparison.
- **Endpoints:** urinary pyridinoline, urinary deoxypyridinoline, bone alkaline phosphatase, osteocalcin.
- **Effect/direction:** Accessible abstract reports borderline reduction in urinary pyridinoline and significant increase in bone alkaline phosphatase in collagen-peptide group; calcium group had no statistically significant marker changes.
- **Adverse events/safety:** Adverse events were not described in accessible abstract; dropouts were reported.
- **Limitations:** Hard-to-retrieve older source; no DOI/PMID located.; High differential attrition in calcium comparator group.; BMD outcomes are not clearly reported in the accessible abstract despite osteoporosis population.; Comparator was calcium only, not placebo.
- **Population mismatch/directness:** Direct osteoporosis population, but older methods, limited access, and biomarker-focused report.

**Why it matters:** It is one of the few older HCP-alone osteoporosis sources, but its accessibility and attrition require explicit caution.

**Potential experiment signals:** urinary pyridinoline, deoxypyridinoline, bone alkaline phosphatase, osteocalcin, dropout rate.

**Protocol takeaway:** Mention only as uncertain historical direct evidence; avoid strong BMD or fracture claims.

**Claim use:** `supports-protocol`.

**Artifact candidates and rights:** `unknown`. Do not place copyrighted PDFs in Git; preserve metadata/source-page draft unless rights are clearly open and redistributable.
