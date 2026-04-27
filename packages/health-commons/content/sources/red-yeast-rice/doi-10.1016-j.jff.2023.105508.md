---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1016-j.jff.2023.105508"
slug: "sources/red-yeast-rice/doi-10.1016-j.jff.2023.105508"
title: "Red yeast rice preparations for dyslipidemia: An overview of systematic reviews and network meta-analysis"
summary: "The review/NMA is useful for separating preparation-specific evidence and evidence-quality concerns; it should not be collapsed into a single plain OTC red yeast rice effect estimate."
status: "draft"
quality: "usable"
aliases:
  - "doi-10.1016-j.jff.2023.105508"
  - "Red yeast rice preparations for dyslipidemia: An overview of systematic reviews and network meta-analysis"
categories:
  - "red-yeast-rice"
  - "adjacent-combination-evidence"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "review"
  title: "Red yeast rice preparations for dyslipidemia: An overview of systematic reviews and network meta-analysis"
  authors: "Fangfang Zhao; Luying Chen; Yuerong Jiang; Yaxin Guo; Lijie Lu; Chunli Lu; Xue Xue; Xuehan Liu; Xinyan Jin; Jianping Liu; Keji Chen"
  journal: "Journal of Functional Foods"
  citation: "Fangfang Zhao; Luying Chen; Yuerong Jiang; Yaxin Guo; Lijie Lu; Chunli Lu; Xue Xue; Xuehan Liu; Xinyan Jin; Jianping Liu; Keji Chen. 2023. Red yeast rice preparations for dyslipidemia: An overview of systematic reviews and network meta-analysis. Journal of Functional Foods. doi:10.1016/j.jff.2023.105508"
  year: 2023
  doi: "10.1016/j.jff.2023.105508"
  url: "https://doi.org/10.1016/j.jff.2023.105508"
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.1016/j.jff.2023.105508"
    titleHash: "7a7d5ee88271db4217455fda80b9b9b63cc50c25cd3baa1c7f00112086e73f18"
    url: "https://doi.org/10.1016/j.jff.2023.105508"
  canonicalUrl: "https://doi.org/10.1016/j.jff.2023.105508"
researchEvidence:
  designKind: "meta_analysis"
  designLabel: "overview of systematic reviews and network meta-analysis"
  populationLabel: "People with dyslipidemia represented in systematic reviews and randomized trials of red yeast rice preparations."
  durationLabel: "Varied across included reviews and trials."
  aggregateRole: "primary"
  cohortKey: "cohort_doi_10_1016_j_jff_2023_105508"
  notes:
    - "Comparator/control: Network and review-level comparators across red yeast rice preparations and controls."
    - "Population mismatch: Aggregate evidence includes proprietary preparations and special preparation classes, not necessarily consumer plain RYR."
    - "Limitations: Umbrella/NMA methods depend on prior reviews, heterogeneous preparations, and product-specific comparators."
evidenceBucket: "Adjacent combinations and special-population evidence"
whyItMatters: "Broad overview plus NMA; captures preparation-specific comparisons and evidence-quality concerns that must be separated from generic RYR supplement evidence."
potentialMurphEndpoints:
  - "ldl-c"
  - "total-cholesterol"
  - "triglycerides"
  - "hdl-c"
  - "adverse-events"
protocolTakeaway: "Do not use as a direct plain red-yeast-rice efficacy claim unless a separable RYR-only arm is verified; use for boundary/context only."
murphTakeaway: "The review/NMA is useful for separating preparation-specific evidence and evidence-quality concerns; it should not be collapsed into a single plain OTC red yeast rice effect estimate. For Murph, the usable takeaway is the boundary: Aggregate evidence includes proprietary preparations and special preparation classes, not necessarily consumer plain RYR."
studyDesign: "overview of systematic reviews and network meta-analysis"
modality: "synthesis of preparation variants"
claimUse: "context-only"
sourceFindings:
  -
    findingId: "finding:doi-10.1016-j.jff.2023.105508-adjacent"
    sourceKey: "source_artifact:doi-10.1016-j.jff.2023.105508"
    findingKind: "context"
    population: "People with dyslipidemia represented in systematic reviews and randomized trials of red yeast rice preparations."
    exposure: "Multiple red yeast rice preparations, including named/proprietary preparations such as Xuezhikang and Zhibituo."
    outcome: "LDL-C, total cholesterol, triglycerides, HDL-C, major cardiovascular events, and safety."
    summary: "The review/NMA is useful for separating preparation-specific evidence and evidence-quality concerns; it should not be collapsed into a single plain OTC red yeast rice effect estimate. Boundary: Umbrella/NMA methods depend on prior reviews, heterogeneous preparations, and product-specific comparators."
    evidenceUse:
      - "context"
      - "adjacent_variant"
      - "safety"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
---
This source is included for **Adjacent combinations and special-population evidence**.

**Findings:** The review/NMA is useful for separating preparation-specific evidence and evidence-quality concerns; it should not be collapsed into a single plain OTC red yeast rice effect estimate.

**Why it matters:** Broad overview plus NMA; captures preparation-specific comparisons and evidence-quality concerns that must be separated from generic RYR supplement evidence.

**Potential experiment signals:** ldl-c, total-cholesterol, triglycerides, hdl-c, adverse-events.

**Protocol takeaway:** Do not promote this source to a direct plain red yeast rice claim without a separable RYR-only arm. Preserve the boundary: Aggregate evidence includes proprietary preparations and special preparation classes, not necessarily consumer plain RYR.

**Claim use:** `context-only`.

**Comparator/control:** Network and review-level comparators across red yeast rice preparations and controls.

**Duration/follow-up:** Varied across included reviews and trials.

**Safety/adverse events:** Safety is addressed at aggregate level, but this batch did not extract preparation-specific adverse-event rates.

**Limitations:** Umbrella/NMA methods depend on prior reviews, heterogeneous preparations, and product-specific comparators.
