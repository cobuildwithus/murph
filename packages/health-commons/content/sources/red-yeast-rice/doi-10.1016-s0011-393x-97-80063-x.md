---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1016-s0011-393x-97-80063-x"
slug: "sources/red-yeast-rice/doi-10.1016-s0011-393x-97-80063-x"
title: "Multicenter clinical trial of the serum lipid-lowering effects of a Monascus purpureus (red yeast) rice preparation from traditional Chinese medicine"
summary: "Older multicenter controlled trial of a Monascus purpureus red yeast rice preparation in hyperlipidemia reporting LDL-C and total-cholesterol reductions over 8 weeks."
status: "draft"
quality: "usable"
aliases:
  - "Wang 1997 Monascus purpureus red yeast rice trial"
  - "Chinese multicenter Monascus purpureus lipid trial"
categories:
  - "red-yeast-rice"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "journal_article"
  title: "Multicenter clinical trial of the serum lipid-lowering effects of a Monascus purpureus (red yeast) rice preparation from traditional Chinese medicine"
  authors: "Wang JX; Lu ZL; Chi JM; Wang WH; Su MZ; Kou WR; Yu PL; Yu LJ; Zhu JS; Chang J"
  year: 1997
  journal: "Current Therapeutic Research"
  citation: "Wang JX, Lu ZL, Chi JM, et al. Multicenter clinical trial of the serum lipid-lowering effects of a Monascus purpureus (red yeast) rice preparation from traditional Chinese medicine. Current Therapeutic Research. 1997;58(12):964-978. doi:10.1016/S0011-393X(97)80063-X."
  doi: "10.1016/s0011-393x(97)80063-x"
  url: "https://doi.org/10.1016/S0011-393X(97)80063-X"
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.1016/s0011-393x(97)80063-x"
    titleHash: "1b44a8b54ac716285163eeefc6c4f97cbfe5a0767b9891e2e86af36785ee3439"
    url: "https://doi.org/10.1016/S0011-393X(97)80063-X"
  canonicalUrl: "https://doi.org/10.1016/S0011-393X(97)80063-X"
researchEvidence:
  designKind: "controlled_trial"
  designLabel: "Multicenter single-masked active-comparator clinical trial"
  participantCount: 446
  participantCountKind: "reported"
  populationLabel: "Patients with hyperlipidemia enrolled in a multicenter Chinese clinical trial."
  durationLabel: "8 weeks"
  aggregateRole: "primary"
  cohortKey: "doi-10.1016-s0011-393x-97-80063-x"
evidenceBucket: "Direct protocol and dose evidence"
whyItMatters: "Anchors early direct human RYR lipid evidence while highlighting product-era and comparator limitations."
potentialMurphEndpoints:
  - "LDL-C"
  - "total cholesterol"
  - "HDL-C"
  - "triglycerides"
  - "tolerability"
protocolTakeaway: "Use as supportive historical direct evidence only after preserving active-comparator and formulation caveats."
murphTakeaway: "RYR showed lipid-lowering signals, but product identity and comparator design limit direct translation to a modern self-experiment."
studyDesign: "Single-masked multicenter controlled clinical trial"
modality: "Red yeast rice supplement"
claimUse: "supports-protocol"
directness: "direct_protocol"
interventionOrExposure: "Monascus purpureus red yeast rice preparation from traditional Chinese medicine."
comparatorOrControl: "Positive control reported as Jiaogulan/Gynostemma in accessible extraction notes, not placebo."
durationOrFollowUp: "8 weeks"
endpoints:
  - "LDL-C"
  - "total cholesterol"
  - "HDL-C"
  - "triglycerides"
  - "tolerability"
effectEstimatesOrDirection: "RYR group reported TC -22.7%, LDL-C -30.9%, and HDL-C +19.9% over 8 weeks; positive-control group reported smaller lipid changes."
adverseEventsOrSafetyNotes: "Mild heartburn, flatulence, and dizziness were reported in accessible extraction notes."
limitations: "Older study, active comparator rather than placebo, proprietary/traditional preparation, and limited safety-detail extraction."
populationMismatch: "Adults with hyperlipidemia; applicability depends on matching product monacolin content and clinical setting."
sourceFindings:
  -
    findingId: "finding:doi-10-1016-s0011-393x-97-80063-x-lipids"
    sourceKey: "source_artifact:doi-10.1016-s0011-393x-97-80063-x"
    findingKind: "intervention_result"
    population: "Patients with hyperlipidemia enrolled in a multicenter Chinese clinical trial."
    exposure: "Monascus purpureus red yeast rice preparation from traditional Chinese medicine."
    outcome: "Serum lipids"
    summary: "In a 446-participant multicenter controlled trial, a Monascus purpureus red yeast rice preparation reported TC -22.7%, LDL-C -30.9%, and HDL-C +19.9% after 8 weeks; the positive-control arm reported smaller changes."
    evidenceUse:
      - "efficacy"
  -
    findingId: "finding:doi-10-1016-s0011-393x-97-80063-x-tolerability"
    sourceKey: "source_artifact:doi-10.1016-s0011-393x-97-80063-x"
    findingKind: "adverse_event"
    population: "Patients with hyperlipidemia enrolled in a multicenter Chinese clinical trial."
    exposure: "Monascus purpureus red yeast rice preparation from traditional Chinese medicine."
    outcome: "Adverse events"
    summary: "Accessible extraction notes report mild heartburn, flatulence, and dizziness; detailed AE denominators were not extracted."
    evidenceUse:
      - "safety"
murphV1Priority: "High"
pdfRightsStatus: "permission_required"
---
This source is included for **Direct protocol and dose evidence**.

**Findings:** RYR group reported TC -22.7%, LDL-C -30.9%, and HDL-C +19.9% over 8 weeks; positive-control group reported smaller lipid changes. Mild heartburn, flatulence, and dizziness were reported in accessible extraction notes.

**Why it matters:** Anchors early direct human RYR lipid evidence while highlighting product-era and comparator limitations.

**Potential experiment signals:** LDL-C, total cholesterol, HDL-C, triglycerides, tolerability.

**Protocol takeaway:** Use as supportive historical direct evidence only after preserving active-comparator and formulation caveats.

**Claim use:** `supports-protocol`.

**Directness and boundary:** direct_protocol. Older study, active comparator rather than placebo, proprietary/traditional preparation, and limited safety-detail extraction. Population mismatch: Adults with hyperlipidemia; applicability depends on matching product monacolin content and clinical setting.
