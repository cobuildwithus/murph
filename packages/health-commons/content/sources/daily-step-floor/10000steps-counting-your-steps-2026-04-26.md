---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:10000steps-counting-your-steps-2026-04-26
slug: sources/daily-step-floor/10000steps-counting-your-steps-2026-04-26
title: Counting Your Steps
summary: External program page describing step counting, tracker caveats, 10,000-step categories, individualized goals, and safety caveats.
status: draft
quality: usable
aliases:
- 10,000 Steps Australia Counting Your Steps webpage
- 10000steps-counting-your-steps-2026-04-26
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: web_page
  title: Counting Your Steps
  authors: 10,000 Steps Team
  year: 2016
  journal: 10,000 Steps
  url: https://www.10000steps.org.au/learn-and-discover/counting-steps
  citation: 10,000 Steps Team. Counting Your Steps. 10,000 Steps; 22 March 2016. Accessed 26 April 2026.
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 88f77331ecec6f23b55e4a6db9b83c367079ec989f9921f88b26d3a1eaadb813
    url: https://www.10000steps.org.au/learn-and-discover/counting-steps
  canonicalUrl: https://www.10000steps.org.au/learn-and-discover/counting-steps
researchEvidence:
  designKind: other
  designLabel: External program guidance webpage
  populationLabel: General 10,000 Steps website users and healthy adults; page also notes that a 10,000-step goal may not suit every person or population.
  durationLabel: Not applicable; webpage guidance.
  cohortKey: cohort:daily-step-floor/10000steps-counting-your-steps-2026-04-26
  aggregateRole: primary
evidenceBucket: guidelines_external_protocol_context
whyItMatters: Useful for historical/external protocol-claim context and for separating public-facing 10,000-step messaging from direct evidence.
potentialMurphEndpoints:
- daily_step_count
- step_goal_adherence
- device_carriage_or_tracker_choice
- safety_boundary
protocolTakeaway: Use as context-only external protocol claim; do not cite it as independent efficacy evidence for a Daily Step Floor.
murphTakeaway: Use personalized step floors and device-consistency cautions rather than assuming 10,000 steps is universal.
studyDesign: other
modality: external_step_goal_guidance
claimUse: context-only
sourceFindings:
- findingId: finding:daily-step-floor/10000steps-counting-your-steps-2026-04-26/context
  sourceKey: source_artifact:10000steps-counting-your-steps-2026-04-26
  extractedFromArtifactId: art_10000steps_counting_your_steps_2026_04_26_source_extract
  findingKind: context
  population: General 10,000 Steps website users and healthy adults; page also notes that a 10,000-step goal may not suit every person or population.
  exposure: Step counting, activity trackers, pedometers, smartphone step counters, 10,000 steps/day external goal, and individualized goal setting.
  outcome: daily step count; tracker choice; step-goal categories; motivation; safety boundary
  summary: The 10,000 Steps page presents 10,000 steps/day as a healthy-adult target, cautions that it may not fit everyone, describes tracker/pedometer/phone measurement issues, and recommends personal goals and medical consultation for starting activity.
  evidenceUse:
  - context
  - measurement
  - safety
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **guidelines_external_protocol_context**.

**Findings:** The 10,000 Steps page presents 10,000 steps/day as a healthy-adult target, cautions that it may not fit everyone, describes tracker/pedometer/phone measurement issues, and recommends personal goals and medical consultation for starting activity.

**Why it matters:** Useful for historical/external protocol-claim context and for separating public-facing 10,000-step messaging from direct evidence.

**Potential experiment signals:** daily_step_count, step_goal_adherence, device_carriage_or_tracker_choice, safety_boundary.

**Protocol takeaway:** Use as context-only external protocol claim; do not cite it as independent efficacy evidence for a Daily Step Floor.

**Claim use:** `context-only`.

## Extraction notes

- **Population:** General 10,000 Steps website users and healthy adults; page also notes that a 10,000-step goal may not suit every person or population.
- **Exposure/intervention:** Step counting, activity trackers, pedometers, smartphone step counters, 10,000 steps/day external goal, and individualized goal setting.
- **Comparator/control:** No comparator or control group; educational webpage.
- **Duration/follow-up:** Not applicable; webpage guidance.
- **Endpoints:** daily step count; tracker choice; step-goal categories; motivation; safety boundary
- **Effect estimates or direction:** Claims 10,000 steps/day is a recommended target for healthy adults while explicitly noting it may not be right for everyone and that increasing by 1,000-2,000 steps/day can still be beneficial; these are external claims, not source-specific trial results.
- **Adverse events/safety notes:** Advises consultation with a doctor before commencing a physical activity program; notes 10,000 steps is not universal across age and physical-function contexts.
- **Limitations:** Educational/external program webpage; claims are not independently tested in the page; device accuracy caveats are general.
- **Population mismatch:** External 10,000 Steps program guidance, not a Murph Daily Step Floor protocol trial.
- **Artifact rights:** unknown
