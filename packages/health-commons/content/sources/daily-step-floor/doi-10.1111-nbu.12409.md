---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1111-nbu.12409
slug: sources/daily-step-floor/doi-10.1111-nbu.12409
title: 'UK Chief Medical Officers'' physical activity guidelines 2019: What''s new and how can we get people more active?'
summary: Nutrition Bulletin commentary on the 2019 UK CMO guidelines; low-priority guideline context only.
status: draft
quality: usable
aliases:
- Gibson-Moore 2019 UK CMO physical activity guidelines commentary
- doi-10.1111-nbu.12409
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: review
  title: 'UK Chief Medical Officers'' physical activity guidelines 2019: What''s new and how can we get people more active?'
  authors: Gibson-Moore H
  year: 2019
  journal: Nutrition Bulletin
  doi: 10.1111/nbu.12409
  url: https://onlinelibrary.wiley.com/doi/10.1111/nbu.12409
  citation: 'Gibson-Moore H. UK Chief Medical Officers'' physical activity guidelines 2019: What''s new and how can we get people more active? Nutrition Bulletin. 2019;44(4):320-328. doi:10.1111/nbu.12409.'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1111/nbu.12409
    titleHash: bd039713f546d809eaf8e68557ab0ede535542cad5a6dd62cfacb2ffbb93925c
    url: https://onlinelibrary.wiley.com/doi/10.1111/nbu.12409
  canonicalUrl: https://doi.org/10.1111/nbu.12409
researchEvidence:
  designKind: guideline
  designLabel: Narrative commentary on UK guideline update
  populationLabel: Readers and practitioners interpreting UK Chief Medical Officers physical-activity guidelines; no participant cohort.
  durationLabel: Not applicable; commentary.
  cohortKey: cohort:daily-step-floor/doi-10.1111-nbu.12409
  aggregateRole: primary
evidenceBucket: guidelines_external_protocol_context
whyItMatters: Useful secondary context on UK guideline communication and behaviour-change framing, but not source-owned efficacy evidence.
potentialMurphEndpoints:
- physical_activity_minutes
- implementation_context
- sedentary_time
protocolTakeaway: Use only as low-priority guideline-context commentary; prefer official guideline for primary claims.
murphTakeaway: Implementation language can be informed by guideline commentary, but direct claims need primary evidence.
studyDesign: narrative_review
modality: physical_activity_guideline_context
claimUse: context-only
sourceFindings:
- findingId: finding:daily-step-floor/doi-10.1111-nbu.12409/context
  sourceKey: source_artifact:doi-10.1111-nbu.12409
  extractedFromArtifactId: art_doi_10_1111_nbu_12409_source_extract
  findingKind: context
  population: Readers and practitioners interpreting UK Chief Medical Officers physical-activity guidelines; no participant cohort.
  exposure: Commentary on 2019 UK Chief Medical Officers physical-activity guideline updates and activity-promotion strategies.
  outcome: guideline updates; physical activity promotion; public-health communication
  summary: The commentary summarizes the 2019 UK CMO physical-activity guideline changes and activity-promotion considerations, but does not evaluate a daily step-count intervention.
  evidenceUse:
  - context
murphV1Priority: Low
pdfRightsStatus: permission_required
---

This source is included for **guidelines_external_protocol_context**.

**Findings:** The commentary summarizes the 2019 UK CMO physical-activity guideline changes and activity-promotion considerations, but does not evaluate a daily step-count intervention.

**Why it matters:** Useful secondary context on UK guideline communication and behaviour-change framing, but not source-owned efficacy evidence.

**Potential experiment signals:** physical_activity_minutes, implementation_context, sedentary_time.

**Protocol takeaway:** Use only as low-priority guideline-context commentary; prefer official guideline for primary claims.

**Claim use:** `context-only`.

## Extraction notes

- **Population:** Readers and practitioners interpreting UK Chief Medical Officers physical-activity guidelines; no participant cohort.
- **Exposure/intervention:** Commentary on 2019 UK Chief Medical Officers physical-activity guideline updates and activity-promotion strategies.
- **Comparator/control:** No comparator or control group; commentary.
- **Duration/follow-up:** Not applicable; commentary.
- **Endpoints:** guideline updates; physical activity promotion; public-health communication
- **Effect estimates or direction:** Summarizes what changed in the 2019 UK guidelines and how to get people more active; no Daily Step Floor intervention result is reported.
- **Adverse events/safety notes:** No adverse events reported; safety only as guideline-level context.
- **Limitations:** Narrative commentary; secondary to the official guideline; not a trial or step-count source.
- **Population mismatch:** UK guideline commentary, not a personal Daily Step Floor protocol.
- **Artifact rights:** permission_required
