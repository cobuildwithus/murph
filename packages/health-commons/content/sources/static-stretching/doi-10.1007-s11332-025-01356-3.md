---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1007/s11332-025-01356-3
slug: sources/static-stretching/doi-10.1007-s11332-025-01356-3
title: 'Effects of muscle stretching exercises on endothelial function in adults: A systematic review'
summary: Systematic review of muscle-stretching exercise effects on endothelial function in adults; included as a vascular-outcome boundary source rather than flexibility evidence.
status: draft
quality: usable
aliases:
- doi-10.1007/s11332-025-01356-3
- Arango-Paternina 2025 stretching endothelial function
categories:
- static-stretching
relations:
-
  type: related_protocol
  target: protocol_variant:static-stretching/at-home-static-stretching-for-flexibility
-
  type: parent_family
  target: experiment_family:static-stretching
source:
  kind: review
  title: 'Effects of muscle stretching exercises on endothelial function in adults: A systematic review'
  authors: Arango-Paternina CM, Ramirez-Villada JF, Marquez-Arabia JJ
  year: 2025
  journal: Sport Sciences for Health
  citation: 'Arango-Paternina CM, Ramirez-Villada JF, Marquez-Arabia JJ. Effects of muscle stretching exercises on endothelial function in adults: A systematic review. Sport Sciences for Health. 2025;21:1313-1326. doi:10.1007/s11332-025-01356-3'
  doi: 10.1007/s11332-025-01356-3
  url: https://doi.org/10.1007/s11332-025-01356-3
researchEvidence:
  designKind: systematic_review
  designLabel: Systematic review of randomized stretching-exercise trials for endothelial function
  populationLabel: Adults aged 17 to 64 years in stretching-exercise endothelial-function studies
  durationLabel: Stretching protocols varied; no meta-analysis due heterogeneity
  aggregateRole: synthesis
  cohortKey: arango-paternina-2025-stretching-endothelial-function
  participantCount: 279
  participantCountKind: reported
  includedStudyCount: 7
evidenceBucket: adjacent_variants_recovery_modalities
whyItMatters: Vascular stretching evidence addresses endothelial function rather than flexibility and should not be used to claim flexibility outcomes.
potentialMurphEndpoints:
- flow-mediated dilation
- endothelial function
- blood pressure context
protocolTakeaway: Use only as vascular context; do not include in static-stretching flexibility claims.
murphTakeaway: Stretching may be studied as a vascular intervention, but the certainty is very low and the outcome is not flexibility.
studyDesign: Systematic review
modality: Muscle stretching exercises for endothelial-function outcomes
directness: adjacent_variant
claimUse: context-only
populationMismatch: Adult vascular-function protocols, not flexibility-seeking home stretching users.
sourceLimitations:
- No meta-analysis due heterogeneity
- Low CONSORT quality and unclear/high risk of bias
- GRADE certainty rated very low
- Outcome mismatch with flexibility
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **adjacent_variants_recovery_modalities**.

**Findings:** Seven articles with 279 participants were included. The review described positive effects as inconsistent across the literature, did not conduct a meta-analysis because of heterogeneity, and rated certainty as very low with low reporting quality and unclear/high risk of bias.

**Why it matters:** Vascular stretching evidence addresses endothelial function rather than flexibility and should not be used to claim flexibility outcomes.

**Potential experiment signals:** flow-mediated dilation, endothelial function, blood pressure context.

**Protocol takeaway:** Use only as vascular context; do not include in static-stretching flexibility claims.

**Claim use:** `context-only`.

## Extraction notes

- **Directness:** `adjacent_variant`.
- **Population:** Adults aged 17 to 64 years in stretching-exercise endothelial-function studies.
- **Intervention or exposure:** Muscle stretching exercises for endothelial-function outcomes.
- **Duration or follow-up:** Stretching protocols varied; no meta-analysis due heterogeneity.
- **Population mismatch:** Adult vascular-function protocols, not flexibility-seeking home stretching users.
- **Adverse events or safety notes:** No extracted adverse-event signal; this source is vascular context, not safety guidance.
- **Limitations:** No meta-analysis due heterogeneity; Low CONSORT quality and unclear/high risk of bias; GRADE certainty rated very low; Outcome mismatch with flexibility.
- **Artifact/rights note:** PDF rights status is `open_access`; do not commit copyrighted PDFs to Git.
