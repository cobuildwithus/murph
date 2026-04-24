---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.25039-ps.b2twa77g"
slug: "sources/morning-light-exposure/doi-10.25039-ps.b2twa77g"
title: "CIE Position Statement on Integrative Lighting - Recommending Proper Light at the Proper Time, 3rd Edition"
summary: "CIE position statement gives professional guidance for proper light at the proper time. Claim use is context-only for protocol_variant:morning-light-exposure/morning-outdoor-light-exposure."
status: "draft"
quality: "usable"
aliases:
  - "CIE Position Statement on Integrative Lighting - Recommending Proper Light at the Proper Time, 3rd Edition"
  - "doi:10.25039/ps.b2twa77g"
categories:
  - "morning-light-exposure"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:morning-light-exposure/morning-outdoor-light-exposure"
  -
    type: "parent_family"
    target: "experiment_family:morning-light-exposure"
source:
  kind: "guideline"
  title: "CIE Position Statement on Integrative Lighting - Recommending Proper Light at the Proper Time, 3rd Edition"
  authors: "International Commission on Illumination (CIE)"
  year: 2024
  journal: "CIE Position Statement"
  citation: "International Commission on Illumination. CIE Position Statement on Integrative Lighting - Recommending Proper Light at the Proper Time, 3rd Edition. CIE PS 001:2024. doi:10.25039/PS.b2twa77g."
  doi: "10.25039/ps.b2twa77g"
  url: "https://cie.co.at/publications/cie-position-statement-integrative-lighting-recommending-proper-light-proper-time-3rd"
researchEvidence:
  designKind: "guideline"
  designLabel: "Professional position statement on integrative lighting"
  populationLabel: "Lighting professionals and integrative-lighting users; not a participant cohort"
  durationLabel: "Not applicable"
  aggregateRole: "synthesis"
  cohortKey: "source-cohort:doi-10.25039-ps.b2twa77g"
protocolEvidence:
  -
    protocolKey: "protocol_variant:morning-light-exposure/morning-outdoor-light-exposure"
    groupId: "dose-measurement-implementation"
    stance: "context_only"
    scope: "same_mechanism"
    result: "not_efficacy_evidence"
    headline: "CIE position statement gives professional guidance for proper light at the proper time."
    implication: "Use as external protocol/measurement context and artifact candidate; do not treat as an outdoor trial."
    caveat: "Position statement, not experimental evidence."
    displayPriority: 90
evidenceBucket: "timing_dose_circadian_metrics"
whyItMatters: "It is an official professional guidance document and the only ledger source in this batch flagged for manifest entry."
potentialMurphEndpoints:
  - "integrative lighting"
  - "proper light at proper time"
  - "melanopic metrics"
  - "timing"
protocolTakeaway: "Use as a practical guidance source with clear claim-use boundaries."
murphTakeaway: "Protocol descriptions should stay aligned with professional lighting guidance without implying medical treatment evidence."
studyDesign: "guideline"
modality: "integrative lighting position statement"
claimUse: "context-only"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
---

This source is included for **timing_dose_circadian_metrics**.

**Findings:**
- The position statement summarizes professional guidance on integrative lighting and proper timing of light.
- It is useful for implementation language around timing and measurement conventions.
- It should not be used as a direct efficacy claim for morning outdoor light.

**Intervention or exposure:** Proper light at the proper time; integrative lighting principles

**Comparator or control:** Not a comparative intervention trial

**Duration or follow-up:** Not applicable

**Endpoints:** Guidance for lighting practice and nonvisual effects

**Effect estimates or direction:** No efficacy effect; guidance source.

**Safety/adverse events:** No adverse events; not a safety trial.

**Limitations:**
- Guidance/position statement.
- No participant sample.
- No adverse-event extraction.

**Population mismatch:** Professional guidance rather than direct user outcomes.

**Directness to Morning Outdoor Light Exposure:** `background`.

**Why it matters:** It is an official professional guidance document and the only ledger source in this batch flagged for manifest entry.

**Potential experiment signals:** integrative lighting, proper light at proper time, melanopic metrics, timing.

**Protocol takeaway:** Use as a practical guidance source with clear claim-use boundaries.

**Claim use:** `context-only`.
