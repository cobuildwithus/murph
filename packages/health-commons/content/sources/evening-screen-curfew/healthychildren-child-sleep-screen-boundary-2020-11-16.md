---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:healthychildren-child-sleep-screen-boundary-2020-11-16"
slug: "sources/evening-screen-curfew/healthychildren-child-sleep-screen-boundary-2020-11-16"
title: "Sleep: How Many Hours Does Your Child Need?"
summary: "AAP/HealthyChildren sleep-habit guidance that recommends keeping screens out of children’s bedrooms and turning off screens at least 60 minutes before bedtime."
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
  title: "Sleep: How Many Hours Does Your Child Need?"
  authors: American Academy of Pediatrics
  year: 2020
  journal: HealthyChildren.org
  url: "https://www.healthychildren.org/English/healthy-living/sleep/Pages/healthy-sleep-habits-how-many-hours-does-your-child-need.aspx"
  citation: "American Academy of Pediatrics. Healthy Sleep Habits: How Many Hours Does Your Child Need? HealthyChildren.org. Last updated November 16, 2020. https://www.healthychildren.org/English/healthy-living/sleep/Pages/healthy-sleep-habits-how-many-hours-does-your-child-need.aspx."
researchEvidence:
  designKind: guideline
  designLabel: Pediatric professional guidance
  populationLabel: Children, teens, and families
  durationLabel: General guidance; screens off at least 60 minutes before bedtime
  cohortKey: healthychildren-aap-child-sleep-screen-boundary
  aggregateRole: context
  notes:
  - "Directness classification: direct_protocol."
  - "Protocol claim-use classification: context-only."
  - "Discovery shards: sleep-hygiene-guidelines-bundles. Year(s): 2020. Candidate rationale: Accessible clinical translation of AAP sleep and screen advice, useful as external protocol context but not primary evidence."
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

- **Population:** Children and teens; includes teen circadian delay context and family media planning.
- **Intervention or exposure:** Guidance recommends keeping all screens out of children’s bedrooms, especially at night, and turning off all screens at least 60 minutes before bedtime.
- **Comparator or control:** No comparator; clinical translation/guidance page.
- **Duration or follow-up:** Nightly habit guidance; at least 60 minutes before bedtime.
- **Endpoints:** sleep duration, screen curfew, bedroom screen access, teen circadian shift, pediatric sleep concerns
- **Effect estimates or direction:** Recommendation-level direction only; no effect estimate reported.
- **Adverse events or safety notes:** Families are encouraged to recognize sleep problems and discuss concerns with a pediatrician; the site is not a substitute for medical care.
- **Limitations and population mismatch:** Pediatric guidance, not a direct intervention trial; source is copyrighted/reuse-limited.
- **Directness to Digital Sunset:** direct_protocol
- **Claim-use boundary:** context-only
- **Artifact candidates and rights status:** Store metadata/link only; do not copy page content beyond fair-use excerpts.

## Protocol boundary

Use as external pediatric guidance for a 60-minute screen cutoff and bedroom screen boundaries; not trial evidence.

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
