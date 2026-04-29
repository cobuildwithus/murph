---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:10000steps-setting-step-goal-2026-04-26
slug: sources/daily-step-floor/10000steps-setting-step-goal-2026-04-26
title: Setting a Step Goal on the Website
summary: 10,000 Steps support page explaining personalized step-goal setup; context-only for implementation design.
status: draft
quality: usable
aliases:
- 10,000 Steps Australia setting a step goal support page
- 10000steps-setting-step-goal-2026-04-26
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: web_page
  title: Setting a Step Goal on the Website
  authors: 10,000 Steps Team
  journal: 10,000 Steps
  url: https://www.10000steps.org.au/support/website-support/setting-step-goal
  citation: 10,000 Steps Team. Setting a Step Goal on the Website. 10,000 Steps. Accessed 26 April 2026.
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: f132b9e7ded8d7c088a3601586a7813051c49cac414723efe2185d2690f7e4dd
    url: https://www.10000steps.org.au/support/website-support/setting-step-goal
  canonicalUrl: https://www.10000steps.org.au/support/website-support/setting-step-goal
researchEvidence:
  designKind: other
  designLabel: External program support webpage
  populationLabel: 10,000 Steps website users setting a personal step goal.
  durationLabel: Not applicable; support page.
  cohortKey: cohort:daily-step-floor/10000steps-setting-step-goal-2026-04-26
  aggregateRole: primary
evidenceBucket: guidelines_external_protocol_context
whyItMatters: Supports the implementation principle that step goals can be personalized and reviewed, without providing efficacy evidence.
potentialMurphEndpoints:
- step_goal_setting
- step_goal_adherence
- program_engagement
protocolTakeaway: Use as context-only external implementation claim; do not use as efficacy evidence.
murphTakeaway: A Murph step floor can include baseline-informed goal setting and periodic review.
studyDesign: other
modality: external_step_goal_guidance
claimUse: context-only
sourceFindings:
- findingId: finding:daily-step-floor/10000steps-setting-step-goal-2026-04-26/context
  sourceKey: source_artifact:10000steps-setting-step-goal-2026-04-26
  extractedFromArtifactId: art_10000steps_setting_step_goal_2026_04_26_source_extract
  findingKind: context
  population: 10,000 Steps website users setting a personal step goal.
  exposure: Website workflow for entering a personalized step goal based on current activity and reviewing it over time.
  outcome: step goal setting; step goal review; user engagement with website tools
  summary: The 10,000 Steps support page instructs users to set a personalized step goal reflecting current activity, track several days to choose a realistic start, and review the goal as activity improves.
  evidenceUse:
  - context
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **guidelines_external_protocol_context**.

**Findings:** The 10,000 Steps support page instructs users to set a personalized step goal reflecting current activity, track several days to choose a realistic start, and review the goal as activity improves.

**Why it matters:** Supports the implementation principle that step goals can be personalized and reviewed, without providing efficacy evidence.

**Potential experiment signals:** step_goal_setting, step_goal_adherence, program_engagement.

**Protocol takeaway:** Use as context-only external implementation claim; do not use as efficacy evidence.

**Claim use:** `context-only`.

## Extraction notes

- **Population:** 10,000 Steps website users setting a personal step goal.
- **Exposure/intervention:** Website workflow for entering a personalized step goal based on current activity and reviewing it over time.
- **Comparator/control:** No comparator or control group; website support page.
- **Duration/follow-up:** Not applicable; support page.
- **Endpoints:** step goal setting; step goal review; user engagement with website tools
- **Effect estimates or direction:** Recommends personalized step goals based on current activity and regular review; no efficacy result is reported.
- **Adverse events/safety notes:** No adverse-event data reported; safety is implicit through realistic personal goal setting rather than a fixed universal target.
- **Limitations:** Operational support page only; not a study and not an outcomes source.
- **Population mismatch:** External website feature instructions, not a Daily Step Floor trial or guideline.
- **Artifact rights:** unknown
