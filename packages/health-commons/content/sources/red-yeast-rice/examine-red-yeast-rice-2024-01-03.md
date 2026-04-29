---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:examine-red-yeast-rice-2024-01-03"
slug: "sources/red-yeast-rice/examine-red-yeast-rice-2024-01-03"
title: "Red Yeast Rice"
summary: "External supplement reference page used to capture public-facing red yeast rice dose and LDL-cholesterol claims; it is not primary protocol evidence."
status: "draft"
quality: "usable"
aliases:
  - "Examine red yeast rice supplement page"
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
  kind: "web_page"
  title: "Red Yeast Rice"
  authors: "Examine"
  year: 2024
  journal: "Examine Supplement Database"
  citation: "Examine. Red Yeast Rice. Examine Supplement Database. Updated January 3, 2024."
  url: "https://examine.com/supplements/red-yeast-rice/"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    url: "https://examine.com/supplements/red-yeast-rice/"
  canonicalUrl: "https://examine.com/supplements/red-yeast-rice/"
researchEvidence:
  designKind: "other"
  designLabel: "External supplement reference page"
  populationLabel: "Consumers and clinicians reading supplement information; no enrolled study population."
  durationLabel: "Not applicable."
  aggregateRole: "primary"
  cohortKey: "examine-red-yeast-rice-external-page"
evidenceBucket: "Guidelines and external protocol claims"
whyItMatters: "Helps identify public-facing dosing and benefit claims that Murph should either substantiate with source-owned clinical evidence or explicitly keep outside protocol claims."
potentialMurphEndpoints:
  - "LDL-C"
  - "total cholesterol"
  - "adverse-event monitoring"
  - "dose/formulation claims"
protocolTakeaway: "Use only as external context; do not cite it as proof that a Murph red yeast rice protocol lowers LDL-C."
murphTakeaway: "External dose pages can shape user expectations, but Murph claims should cite trials, reviews, and safety/regulatory sources instead."
studyDesign: "external supplement information page"
modality: "nutraceutical supplement"
claimUse: "context-only"
sourceFindings:

  -
    findingId: "finding:examine-red-yeast-rice-2024-01-03/external-dose-claim"
    sourceKey: "source_artifact:examine-red-yeast-rice-2024-01-03"
    findingKind: "context"
    population: "General supplement-information audience; not a trial population."
    exposure: "External red yeast rice supplement page; search-index text describes 600 mg twice daily as the most common dose."
    outcome: "LDL-C and atherosclerosis claims on an external supplement reference page."
    summary: "Examine search-index text for the January 3, 2024 red yeast rice page states that 600 mg twice daily is the most common dose and that this dose has demonstrated effectiveness for reducing LDL cholesterol and improving atherosclerosis. The page itself was not fully retrievable in this extraction run, so this is retained only as an external-protocol claim to verify against primary or review evidence."
    evidenceUse:
      - "context"
murphV1Priority: "Low"
pdfRightsStatus: "unknown"
---
This source is included for **Guidelines and external protocol claims**.

**Findings:** The retrievable search-index text captures a 600 mg twice-daily dose claim and LDL-C/atherosclerosis benefit language. The full page was not accessible in this run, so the finding is intentionally treated as an external claim rather than evidence.

**Why it matters:** This page is useful for claim-boundary work because it reflects a common consumer-facing protocol description.

**Potential experiment signals:** Potential signals are LDL-C, total cholesterol, adherence to a twice-daily regimen, and adverse-effect questions that should be checked in direct evidence.

**Protocol takeaway:** Do not promote the Examine dose claim into protocol efficacy text unless it is supported by direct red yeast rice evidence.

**Claim use:** `context-only`.
