---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct06464718-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct06464718-2026-04-25
title: Effectiveness of Calcium and Vitamin D, With and Without Collagen Peptide, in Enhancing Bone Mineral Density on Postmenopausal Women with Osteopenia
summary: Registry identifier anchors the 2025 small calcium/D ± collagen peptide osteopenia RCT.
status: draft
quality: usable
aliases:
- Effectiveness of Calcium and Vitamin D, With and Without Collagen Peptide, in Enhancing Bone Mineral Density on Postmenopausal Women with Osteopenia
- NCT06464718 Khan 2025 collagen peptide calcium vitamin D osteopenia registry
- NCT06464718
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
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT06464718
    url: https://clinicaltrials.gov/study/NCT06464718
  canonicalUrl: https://clinicaltrials.gov/study/NCT06464718
  identityAliases:
  - Effectiveness of Calcium and Vitamin D, With and Without Collagen Peptide, in Enhancing Bone Mineral Density on Postmenopausal Women with Osteopenia
  - NCT06464718 Khan 2025 collagen peptide calcium vitamin D osteopenia registry
  - NCT06464718
source:
  kind: web_page
  title: Effectiveness of Calcium and Vitamin D, With and Without Collagen Peptide, in Enhancing Bone Mineral Density on Postmenopausal Women with Osteopenia
  authors: ClinicalTrials.gov registry record; investigators not extracted
  citation: ClinicalTrials.gov. Effectiveness of Calcium and Vitamin D, With and Without Collagen Peptide, in Enhancing Bone Mineral Density on Postmenopausal Women with Osteopenia. NCT06464718. Registry snapshot source key dated 2026-04-25.
  year: 2024
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT06464718
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Clinical trial registry record for small calcium/D ± collagen peptide RCT
  populationLabel: Postmenopausal women with osteopenia.
  durationLabel: Short trial; linked abstract reports 3 months.
  cohortKey: collagen-bone-batch-008-clinicaltrials-gov-nct06464718-2026-04-25
  participantCount: 30
  participantCountKind: approximate
  aggregateRole: context
evidenceBucket: bone-density-turnover
whyItMatters: It links the 2025 APMC RCT to a trial registration and supports design verification.
potentialMurphEndpoints:
- registration
- trial design
- BMD/P1NP endpoints
protocolTakeaway: Use as registry context; use the article source for findings.
murphTakeaway: Registration helps detect endpoint switching or thin reporting, especially in small trials.
studyDesign: Clinical trial registry record for small calcium/D ± collagen peptide RCT
modality: trial registry for calcium/D ± collagen peptide
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
ledgerClassification:
  evidenceBucket: bone-density-turnover
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  batchId: batch-008
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: open_access
---

This source is included for **bone-density-turnover**.

**Findings:**

- **Population:** Postmenopausal women with osteopenia.
- **Intervention/exposure:** Calcium/vitamin D plus collagen peptide.
- **Comparator/control:** Calcium/vitamin D without collagen peptide.
- **Duration/follow-up:** Short trial; linked abstract reports 3 months.
- **Endpoints:** BMD in title, P1NP in linked publication.
- **Effect/direction:** Registry source is for design/registration verification; published article supplies P1NP results.
- **Adverse events/safety:** No adverse-event result extracted from registry.
- **Limitations:** ClinicalTrials.gov page content was not fully accessible in extraction environment; use linked publication for results.; Adjunct calcium/D design; not HCP-alone.; Small study.
- **Population mismatch/directness:** Adjacent calcium/D co-intervention registry.

**Why it matters:** It links the 2025 APMC RCT to a trial registration and supports design verification.

**Potential experiment signals:** registration, trial design, BMD/P1NP endpoints.

**Protocol takeaway:** Use as registry context; use the article source for findings.

**Claim use:** `context-only`.

**Artifact candidates and rights:** `open_access`. Do not place copyrighted PDFs in Git; preserve metadata/source-page draft unless rights are clearly open and redistributable.
