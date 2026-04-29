---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1136-bmjopen-2024-088524
slug: sources/daily-step-floor/doi-10.1136-bmjopen-2024-088524
title: 'Objectively measured daily steps and health outcomes: an umbrella review of the systematic review and meta-analysis of observational studies'
summary: This umbrella review included 10 systematic reviews across six health-outcome areas and concluded that objectively measured daily steps were associated with lower all-cause mortality and cardiovascular events; dose-response summaries described lower risk wi...
status: draft
quality: usable
aliases:
- 'Objectively measured daily steps and health outcomes: an umbrella review of the systematic review and meta-analysis of observational studies'
- DOI 10.1136/bmjopen-2024-088524
- doi-10.1136-bmjopen-2024-088524
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: review
  title: 'Objectively measured daily steps and health outcomes: an umbrella review of the systematic review and meta-analysis of observational studies'
  authors: Chunlan Xu; Jinli Jia; Binbin Zhao; Man Yuan; Nan Luo; Fan Zhang; Hui Wang
  year: 2024
  journal: BMJ Open
  doi: 10.1136/bmjopen-2024-088524
  url: https://bmjopen.bmj.com/content/14/10/e088524
  citation: 'Xu C, Jia J, Zhao B, Yuan M, Luo N, Zhang F, et al. Objectively measured daily steps and health outcomes: an umbrella review of the systematic review and meta-analysis of observational studies. BMJ Open. 2024;14:e088524. doi:10.1136/bmjopen-2024-088524.'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    pmcid: PMC11474941
    doi: 10.1136/bmjopen-2024-088524
    titleHash: 8b143c2a2f33fd6bf6001c6fe3ddd6d0984cde24a27ac0c3bbecb6c565f14b2a
    url: https://bmjopen.bmj.com/content/14/10/e088524
  canonicalUrl: https://bmjopen.bmj.com/content/14/10/e088524
researchEvidence:
  designKind: systematic_review
  designLabel: Umbrella review of systematic reviews and meta-analyses of observational studies
  populationLabel: Humans in observational studies using objectively measured daily steps; populations and outcomes vary by included review.
  durationLabel: Searches through 31 January 2024; follow-up varied by included observational studies.
  cohortKey: doi-10.1136-bmjopen-2024-088524
  includedStudyCount: 10
  aggregateRole: synthesis
  notes:
  - 'Comparator/control: Lower daily step categories or lower dose anchors within included reviews.'
  - 'Limitations: Umbrella review of observational evidence with review overlap, heterogeneous devices/outcomes, variable methodological quality, and residual confounding; not a causal test of a Daily Step Floor protocol.'
  - 'Population mismatch: Population and measurement methods are heterogeneous and not a single user-level protocol.'
  - 'Safety/adverse events: no source-specific adverse-event signal was extracted for this batch; source is used for dose-response/cut-point context unless otherwise noted.'
evidenceBucket: dose_response_cut_points
whyItMatters: Backbone context for the dose-response landscape around step volume and health outcomes.
potentialMurphEndpoints:
- daily step count
- days meeting step floor
- weekly mean steps
- all-cause mortality
- cardiovascular events
- other health outcomes
protocolTakeaway: Useful for landscape framing that daily step volume has graded observational associations, but not proof that setting a floor changes outcomes.
murphTakeaway: Treat this as reusable source-owned context for step-volume thresholds, dose-response shape, population boundaries, and candidate Murph signals. Do not synthesize it as direct Daily Step Floor efficacy evidence.
studyDesign: systematic_review
modality: walking/ambulatory steps
claimUse: context-only
sourceFindings:
- findingId: finding:daily-step-floor/doi-10.1136-bmjopen-2024-088524/dose-response-context
  sourceKey: source_artifact:doi-10.1136-bmjopen-2024-088524
  extractedFromArtifactId: art_doi_10_1136_bmjopen_2024_088524_landing_page
  findingKind: context
  population: Humans in observational studies using objectively measured daily steps; populations and outcomes vary by included review.
  exposure: Objectively measured daily step count and dose-response increments.
  outcome: daily step count; all-cause mortality; cardiovascular events; other health outcomes
  summary: This umbrella review included 10 systematic reviews across six health-outcome areas and concluded that objectively measured daily steps were associated with lower all-cause mortality and cardiovascular events; dose-response summaries described lower risk with additional 500–1000 daily steps.
  evidenceUse:
  - context
  - adjacent_variant
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **dose_response_cut_points**.

**Findings:** This umbrella review included 10 systematic reviews across six health-outcome areas and concluded that objectively measured daily steps were associated with lower all-cause mortality and cardiovascular events; dose-response summaries described lower risk with additional 500–1000 daily steps.

**Why it matters:** Backbone context for the dose-response landscape around step volume and health outcomes.

**Potential experiment signals:** daily step count, days meeting step floor, weekly mean steps, all-cause mortality, cardiovascular events, other health outcomes.

**Protocol takeaway:** Useful for landscape framing that daily step volume has graded observational associations, but not proof that setting a floor changes outcomes.

**Claim use:** `context-only`.

## Extraction notes

- **Population:** Humans in observational studies using objectively measured daily steps; populations and outcomes vary by included review.
- **Exposure/intervention:** Objectively measured daily step count and dose-response increments.
- **Comparator/control:** Lower daily step categories or lower dose anchors within included reviews.
- **Duration/follow-up:** Searches through 31 January 2024; follow-up varied by included observational studies.
- **Endpoints:** daily step count, all-cause mortality, cardiovascular events, other health outcomes
- **Safety/adverse events:** No adverse-event signal specific to a step-floor intervention was extracted from this source in this batch.
- **Limitations:** Umbrella review of observational evidence with review overlap, heterogeneous devices/outcomes, variable methodological quality, and residual confounding; not a causal test of a Daily Step Floor protocol.
- **Population mismatch/directness:** Population and measurement methods are heterogeneous and not a single user-level protocol.
- **Boundary:** This source is observational, review-based, registry-only, or otherwise adjacent unless explicitly noted; it must not be promoted into direct Daily Step Floor protocol evidence.
