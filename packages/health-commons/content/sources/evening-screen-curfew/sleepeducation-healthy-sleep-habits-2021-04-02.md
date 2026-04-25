---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:sleepeducation-healthy-sleep-habits-2021-04-02"
slug: "sources/evening-screen-curfew/sleepeducation-healthy-sleep-habits-2021-04-02"
title: Healthy Sleep Habits
summary: AASM SleepEducation sleep-habit guidance that includes turning off electronic devices at least 30 minutes before bedtime.
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
  title: Healthy Sleep Habits
  authors: American Academy of Sleep Medicine
  year: 2021
  journal: SleepEducation.org
  url: "https://sleepeducation.org/healthy-sleep/healthy-sleep-habits/"
  citation: "American Academy of Sleep Medicine. Healthy Sleep Habits. SleepEducation.org. April 2, 2021. https://sleepeducation.org/healthy-sleep/healthy-sleep-habits/."
researchEvidence:
  designKind: guideline
  designLabel: Professional sleep-education guidance
  populationLabel: General public
  durationLabel: General guidance; electronic devices off at least 30 minutes before bedtime
  cohortKey: sleepeducation-healthy-sleep-habits-2021
  aggregateRole: context
  notes:
  - "Directness classification: direct_protocol."
  - "Protocol claim-use classification: context-only."
  - "Discovery shards: sleep-hygiene-guidelines-bundles. Year(s): 2021. Candidate rationale: Professional sleep-education guidance with a bounded 30-minute device recommendation; should be treated as expert protocol rather than trial evidence."
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

- **Population:** General public; not a specific trial population.
- **Intervention or exposure:** Guidance includes consistent schedule, bed only for sleep/sex, relaxing bedroom, limiting evening bright light, and turning off electronic devices at least 30 minutes before bedtime.
- **Comparator or control:** No comparator; sleep-education guidance page.
- **Duration or follow-up:** Nightly habit guidance; at least 30 minutes before bedtime.
- **Endpoints:** sleep habits, electronic-device cutoff, bright light, bedtime routine, sleep diary support
- **Effect estimates or direction:** Recommendation-level direction only; no effect estimate reported.
- **Adverse events or safety notes:** The broader AASM sleep-habit ecosystem directs people with ongoing sleep problems toward sleep diary, doctor, or sleep-center support; the specific page is not a trial safety source.
- **Limitations and population mismatch:** Expert sleep-education guidance, not randomized evidence; recommendation is part of a multi-component sleep hygiene bundle.
- **Directness to Digital Sunset:** direct_protocol
- **Claim-use boundary:** context-only
- **Artifact candidates and rights status:** Store metadata/link only; rights for copying page content are not verified.

## Protocol boundary

Use as external expert guidance only; do not treat as causal evidence.

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
