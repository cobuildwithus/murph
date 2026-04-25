---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:cdc-about-sleep-2024-05-15"
slug: "sources/evening-screen-curfew/cdc-about-sleep-2024-05-15"
title: About Sleep
summary: CDC public-health sleep page that includes turning off electronic devices at least 30 minutes before bedtime as a sleep-habit recommendation.
status: draft
quality: usable
categories:
- evening-screen-curfew
- digital-sunset
- sleep-hygiene
- supplemental_sleep_hygiene_insomnia_context
relations:
-
  type: related_protocol
  target: "protocol_variant:evening-screen-curfew/digital-sunset"
-
  type: parent_family
  target: "experiment_family:evening-screen-curfew"
source:
  kind: web_page
  title: About Sleep
  authors: Centers for Disease Control and Prevention
  year: 2024
  journal: CDC Sleep and Sleep Disorders
  url: "https://www.cdc.gov/sleep/about/index.html"
  citation: "Centers for Disease Control and Prevention. About Sleep. Updated May 15, 2024. https://www.cdc.gov/sleep/about/index.html."
researchEvidence:
  designKind: guideline
  designLabel: Government public-health guidance
  populationLabel: General public across age groups
  durationLabel: General guidance; electronic-device cutoff at least 30 minutes before bedtime
  cohortKey: cdc-about-sleep-2024
  aggregateRole: context
  notes:
  - "Directness classification: direct_protocol."
  - "Protocol claim-use classification: context-only."
  - "Discovery shards: sleep-hygiene-guidelines-bundles. Year(s): 2024. Candidate rationale: Government sleep-hygiene advice with a bounded electronic-device cutoff; not a primary evidence source."
sourceContext:
  evidenceBucket: supplemental_sleep_hygiene_insomnia_context
  directness: direct_protocol
  claimUse: context-only
  priority: medium
  batchId: batch-010
  ledgerStudyDesign: guideline
  canonicalIdBasis: url
  artifactRightsStatusGuess: unknown
  needsSourcePage: true
  needsArtifactManifestEntry: false
---

This source is included for **supplemental sleep-hygiene, insomnia, and broad guidance context** for the Digital Sunset protocol.

## Extraction notes

- **Population:** General public; age-specific sleep-duration recommendations are included by CDC.
- **Intervention or exposure:** Better sleep habits including regular bed/wake times, quiet/cool bedroom, turning off electronic devices at least 30 minutes before bedtime, avoiding large meals/alcohol and afternoon/evening caffeine, and regular exercise/healthy diet.
- **Comparator or control:** No comparator; public-health guidance page.
- **Duration or follow-up:** Nightly habit guidance; electronic-device cutoff at least 30 minutes before bedtime.
- **Endpoints:** sleep quality, sleep duration, sleep diary, sleep disorders, electronic-device cutoff
- **Effect estimates or direction:** Recommendation-level direction only; no effect estimate reported.
- **Adverse events or safety notes:** CDC advises talking with a health care provider for regular sleep problems or signs of sleep disorder and notes sleep diaries may help evaluation.
- **Limitations and population mismatch:** Guidance page, not a trial; broad population and multi-component sleep hygiene bundle.
- **Directness to Digital Sunset:** direct_protocol
- **Claim-use boundary:** context-only
- **Artifact candidates and rights status:** Store metadata/link only; no artifact manifest entry requested.

## Protocol boundary

Use as external guidance support for a 30-minute minimum device cutoff; do not cite as primary intervention evidence.

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
