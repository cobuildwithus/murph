---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:drugs-com-gemfibrozil-red-yeast-rice-2026-04-26"
slug: "sources/red-yeast-rice/drugs-com-gemfibrozil-red-yeast-rice-2026-04-26"
title: "Gemfibrozil and red yeast rice Interactions"
summary: "The interaction report flags a major gemfibrozil/red yeast rice interaction and is relevant to exclusion or clinician-guidance logic, not efficacy."
status: "draft"
quality: "usable"
aliases:
  - "drugs-com-gemfibrozil-red-yeast-rice-2026-04-26"
  - "Gemfibrozil and red yeast rice Interactions"
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
  kind: "web_page"
  title: "Gemfibrozil and red yeast rice Interactions"
  authors: "Drugs.com Drug Interactions Checker"
  journal: "Drugs.com Professional Interaction Report"
  citation: "Drugs.com Drug Interactions Checker. 2026. Gemfibrozil and red yeast rice Interactions. Drugs.com Professional Interaction Report"
  year: 2026
  url: "https://www.drugs.com/drug-interactions/gemfibrozil-with-red-yeast-rice-1165-0-1998-0.html?professional=1"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "99c762a39caefea13afec71660d3b1decbc721c040c9a875b97ce12712e868de"
    url: "https://www.drugs.com/drug-interactions/gemfibrozil-with-red-yeast-rice-1165-0-1998-0.html?professional=1"
  canonicalUrl: "https://www.drugs.com/drug-interactions/gemfibrozil-with-red-yeast-rice-1165-0-1998-0.html?professional=1"
researchEvidence:
  designKind: "other"
  designLabel: "professional drug-interaction reference"
  populationLabel: "People considering combined use of gemfibrozil and red yeast rice."
  durationLabel: "Not applicable."
  aggregateRole: "primary"
  cohortKey: "cohort_drugs_com_gemfibrozil_red_yeast_rice_2026_04_26"
  notes:
    - "Comparator/control: Not applicable."
    - "Population mismatch: Safety-only interaction boundary for fibrate co-use."
    - "Limitations: Drug-interaction reference, not a clinical trial or incidence estimate."
evidenceBucket: "Adjacent combinations and special-population evidence"
whyItMatters: "Drug-interaction reference directly grades a gemfibrozil-red yeast rice combination and is relevant to fibrate exclusion/onboarding logic."
potentialMurphEndpoints:
  - "alanine-aminotransferase"
  - "serum-creatinine"
protocolTakeaway: "Do not use as a direct plain red-yeast-rice efficacy claim unless a separable RYR-only arm is verified; use for boundary/context only."
murphTakeaway: "The interaction report flags a major gemfibrozil/red yeast rice interaction and is relevant to exclusion or clinician-guidance logic, not efficacy. For Murph, the usable takeaway is the boundary: Safety-only interaction boundary for fibrate co-use."
studyDesign: "professional drug-interaction reference"
modality: "drug-interaction reference"
claimUse: "safety-only"
sourceFindings:
  -
    findingId: "finding:drugs-com-gemfibrozil-red-yeast-rice-2026-04-26-safety"
    sourceKey: "source_artifact:drugs-com-gemfibrozil-red-yeast-rice-2026-04-26"
    findingKind: "safety"
    population: "People considering combined use of gemfibrozil and red yeast rice."
    exposure: "Gemfibrozil plus red yeast rice; related food interaction note includes grapefruit exposure."
    outcome: "Drug interactions, liver injury risk, rhabdomyolysis risk, kidney injury risk, and clinician-monitoring boundary."
    summary: "The interaction report flags a major gemfibrozil/red yeast rice interaction and is relevant to exclusion or clinician-guidance logic, not efficacy. Boundary: Drug-interaction reference, not a clinical trial or incidence estimate."
    evidenceUse:
      - "safety"
murphV1Priority: "Medium"
pdfRightsStatus: "unknown"
---
This source is included for **Adjacent combinations and special-population evidence**.

**Findings:** The interaction report flags a major gemfibrozil/red yeast rice interaction and is relevant to exclusion or clinician-guidance logic, not efficacy.

**Why it matters:** Drug-interaction reference directly grades a gemfibrozil-red yeast rice combination and is relevant to fibrate exclusion/onboarding logic.

**Potential experiment signals:** alanine-aminotransferase, serum-creatinine.

**Protocol takeaway:** Do not promote this source to a direct plain red yeast rice claim without a separable RYR-only arm. Preserve the boundary: Safety-only interaction boundary for fibrate co-use.

**Claim use:** `safety-only`.

**Comparator/control:** Not applicable.

**Duration/follow-up:** Not applicable.

**Safety/adverse events:** Warns that combined use may increase risk of liver damage and rhabdomyolysis, which can lead to kidney damage or death; recommends clinical guidance/monitoring.

**Limitations:** Drug-interaction reference, not a clinical trial or incidence estimate.
