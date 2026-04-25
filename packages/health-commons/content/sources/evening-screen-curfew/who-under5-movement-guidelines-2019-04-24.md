---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:who-under5-movement-guidelines-2019-04-24"
slug: "sources/evening-screen-curfew/who-under5-movement-guidelines-2019-04-24"
title: WHO guidelines on physical activity, sedentary behaviour and sleep for children under 5 years of age
summary: "WHO under-5 movement/sedentary-behaviour/sleep guideline; included as broad child screen-time and sleep context with major population mismatch for most digital-sunset users."
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
  kind: guideline
  title: WHO guidelines on physical activity, sedentary behaviour and sleep for children under 5 years of age
  authors: World Health Organization
  year: 2019
  journal: World Health Organization news release and guideline summary
  url: "https://www.who.int/news/item/24-04-2019-to-grow-up-healthy-children-need-to-sit-less-and-play-more"
  citation: "World Health Organization. WHO guidelines on physical activity, sedentary behaviour and sleep for children under 5 years of age. News release. April 24, 2019. https://www.who.int/news/item/24-04-2019-to-grow-up-healthy-children-need-to-sit-less-and-play-more."
researchEvidence:
  designKind: guideline
  designLabel: WHO public-health guideline
  populationLabel: Children under 5 years of age
  durationLabel: "Daily 24-hour movement/sedentary/sleep recommendations; not bedtime-specific"
  cohortKey: who-2019-under5-movement-sedentary-sleep-guideline
  aggregateRole: context
  notes:
  - "Directness classification: background."
  - "Protocol claim-use classification: context-only."
  - "Discovery shards: direct-intervention. Year(s): 2019. Candidate rationale: Broad child screen-time/sleep guideline; not bedtime-specific and population-mismatched for many digital-sunset users."
sourceContext:
  evidenceBucket: supplemental_sleep_hygiene_insomnia_context
  directness: background
  claimUse: context-only
  priority: low
  batchId: batch-010
  ledgerStudyDesign: guideline
  canonicalIdBasis: url
  artifactRightsStatusGuess: unknown
  needsSourcePage: true
  needsArtifactManifestEntry: false
---

This source is included for **supplemental sleep-hygiene, insomnia, and broad guidance context** for the Digital Sunset protocol.

## Extraction notes

- **Population:** Infants and children under 5 years of age.
- **Intervention or exposure:** Daily movement, sedentary behaviour, and sleep recommendations; no screen time for infants and limits on sedentary screen time for ages 1-4.
- **Comparator or control:** No comparator; public-health guideline.
- **Duration or follow-up:** 24-hour daily behaviour recommendations; not a bedtime cutoff intervention.
- **Endpoints:** sedentary screen time, physical activity, sleep duration, under-5 population mismatch
- **Effect estimates or direction:** Recommendation-level direction only; no effect estimate reported on bedtime screen curfews.
- **Adverse events or safety notes:** Main safety context is age-appropriate sedentary behaviour and adequate sleep; not a medical insomnia source.
- **Limitations and population mismatch:** Population-mismatched for most digital-sunset users; not specific to bedtime or personal screens before bed.
- **Directness to Digital Sunset:** background
- **Claim-use boundary:** context-only
- **Artifact candidates and rights status:** Store metadata/link only; no artifact manifest entry requested.

## Protocol boundary

Context-only for very young children; do not use as direct evidence for bedtime personal-screen curfew in older users.

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
