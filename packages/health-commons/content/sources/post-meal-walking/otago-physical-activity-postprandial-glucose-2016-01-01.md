---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:otago-physical-activity-postprandial-glucose-2016-01-01
slug: sources/post-meal-walking/otago-physical-activity-postprandial-glucose-2016-01-01
title: Physical Activity in Postprandial Blood Glucose Control
summary: University of Otago doctoral thesis summarizing multiple postprandial-activity studies, including a 41-adult T2D crossover trial, a 28-participant 3-month walking adherence analysis, and timing trials in 78 euglycemic young adults.
status: draft
quality: usable
aliases:
- University of Otago thesis
- Andrew Nathan Reynolds thesis
- hdl:10523/6611
categories:
- post-meal-walking
relations:
-
  type: related_protocol
  target: protocol_variant:post-meal-walking/walking-after-every-meal
-
  type: parent_family
  target: experiment_family:post-meal-walking
source:
  kind: other
  title: Physical Activity in Postprandial Blood Glucose Control
  authors: Andrew Nathan Reynolds
  year: 2016
  journal: University of Otago doctoral thesis
  citation: 'Reynolds AN. Physical Activity in Postprandial Blood Glucose Control. Doctoral thesis, University of Otago. 2016. Handle: 10523/6611.'
  url: https://hdl.handle.net/10523/6611
sourceIdentity:
  identityKind: other
  canonicalIdBasis: url
  identifiers:
    url: https://hdl.handle.net/10523/6611
  canonicalUrl: https://hdl.handle.net/10523/6611
  identityAliases:
  - University of Otago thesis
  - Andrew Nathan Reynolds thesis
  - hdl:10523/6611
researchEvidence:
  designKind: other
  designLabel: Doctoral thesis with systematic review, crossover trials, and mixed-methods adherence analysis
  populationLabel: 'Multiple cohorts: adults with type 2 diabetes in free-living walking chapters and euglycemic young adults in timing/cycling trials.'
  durationLabel: 'Multiple chapter durations: 2-week crossover walking trial, 3-month walking prescription analysis, and acute post-meal timing trials.'
  aggregateRole: primary
  cohortKey: cohort:otago-physical-activity-postprandial-glucose-2016-01-01
  notes:
  - Thesis-level source with multiple cohorts and modalities; frontmatter participantCount set to 0 to avoid collapsing distinct samples.
  - Full text is not accessible via OUR Archive and copyright is all rights reserved unless indicated.
  - Useful for methods/adherence context, but protocol claims should cite primary journal articles where available.
evidenceBucket: free-living-adherence-registries-external-claims
whyItMatters: The thesis captures direct walking-after-meals methods and qualitative adherence context not always visible in abstracts, while rights and source hierarchy require caution.
potentialMurphEndpoints:
- postprandial glucose
- accelerometer-measured activity
- self-rated health
- walking adherence barriers
- activity timing
protocolTakeaway: Use as context-only support for methods and adherence; prefer peer-reviewed article pages for protocol claims when available.
murphTakeaway: 'Adherence context matters: family support and perceived benefits can help, while evening darkness and security concerns can block walking after dinner.'
studyDesign: other
modality: postprandial walking and related physical activity
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: permission_required
---
This source is included for **free-living-adherence-registries-external-claims**.

**Findings:** The thesis abstract reports a 2-week T2D walking-after-meals crossover trial with reduced postprandial glucose, a 3-month adherence/motivator analysis, and mixed timing findings from very-light cycling trials.

**Why it matters:** The thesis captures direct walking-after-meals methods and qualitative adherence context not always visible in abstracts, while rights and source hierarchy require caution.

**Potential experiment signals:** postprandial glucose, accelerometer-measured activity, self-rated health, walking adherence barriers, activity timing.

**Protocol takeaway:** Use as context-only support for methods and adherence; prefer peer-reviewed article pages for protocol claims when available.

**Claim use:** `context-only`.

## Extraction details

- **Population:** Multiple populations: 41 free-living adults with type 2 diabetes; 28 adults from that trial in a 3-month walking analysis; and 78 euglycemic young adults in acute cycling timing trials.

- **Participant count:** Multiple samples; not represented by a single participant count in frontmatter.

- **Intervention/exposure:** Walking 10 minutes after each main meal versus 30 minutes/day walking; later walking morning/afternoon/evening for 3 months; very-light cycling 15 or 45 minutes after a standardized meal.

- **Comparator/control:** Current physical activity guideline walking dose, pre/post adherence assessment, and alternate post-meal timing conditions depending on chapter.

- **Duration/follow-up:** 2 weeks for the T2D crossover trial; 3 months for walking adherence analysis; acute timing trials for euglycemic young adults.

- **Endpoints:** Postprandial blood glucose; self-rated health; physical activity knowledge/perception; motivators/impediments; timing-related glucose change; glycated albumin technical chapters.

- **Effect estimates or direction:** Abstract reports postprandial blood glucose was reduced by walking after meals in the T2D crossover chapter; self-rated health improved in the 3-month chapter; cycling at 45 minutes after a meal reduced blood glucose directly after cycling, while 15-minute timing showed no change.

- **Adverse events/safety notes:** Fear of walking in the dark among female participants is an implementation/safety barrier; no adverse-event count was extracted.

- **Limitations:** Doctoral thesis; full text restricted; multiple cohorts and modalities; abstract-level extraction; journal articles should be preferred for final protocol claims.

- **Population mismatch:** Partly direct T2D walking-after-meal evidence, partly cycling/healthy-adult and adherence context; canonical directness retained as background.

- **Directness to Walking After Every Meal:** background

- **Artifact candidates and rights:** OUR Archive states all items are copyright protected and the full text is not accessible/restricted; metadata/source-page draft only, no thesis PDF in Git.

## Atomic finding links

- `finding:walking-after-every-meal:otago-physical-activity-postprandial-glucose-2016-01-01:001`
- `finding:walking-after-every-meal:otago-physical-activity-postprandial-glucose-2016-01-01:002`
- `finding:walking-after-every-meal:otago-physical-activity-postprandial-glucose-2016-01-01:003`
