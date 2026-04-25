---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:doi-10.1037/ppm0000156"
slug: "sources/evening-screen-curfew/doi-10.1037-ppm0000156"
title: Nighttime Notifications and Compulsivity Illuminate the Link Between Emerging Adults' Cellphone Use and Sleep-Related Problems
summary: Nighttime notifications and compulsive phone use were associated with sleep-related problems in emerging adults.
status: draft
quality: usable
categories:
- source
- evening-screen-curfew
- digital-sunset
- batch-004
- in_bed_bedroom_device_timing
relations:
-
  type: related_protocol
  target: "protocol_variant:evening-screen-curfew/digital-sunset"
-
  type: parent_family
  target: "experiment_family:evening-screen-curfew"
source:
  kind: journal_article
  title: Nighttime Notifications and Compulsivity Illuminate the Link Between Emerging Adults' Cellphone Use and Sleep-Related Problems
  authors: '[''Karla Klein Murdock'', ''Sue K. Adams'', ''Caroline Crichlow-Ball'', ''Mikael Horissian'', ''Meredith Roberts'']'
  year: 2019
  journal: Psychology of Popular Media Culture
  doi: "10.1037/ppm0000156"
  url: "https://doi.org/10.1037/ppm0000156"
  citation: "Murdock, K. K., Adams, S. K., Crichlow-Ball, C., Horissian, M., & Roberts, M. (2019). Nighttime notifications and compulsivity illuminate the link between emerging adults' cellphone use and sleep-related problems. Psychology of Popular Media Culture, 8(1), 12-21. https://doi.org/10.1037/ppm0000156"
researchEvidence:
  designKind: cross_sectional
  designLabel: Cross-sectional survey in two emerging-adult samples
  participantCount: 425
  participantCountKind: reported
  populationLabel: "Emerging adults/undergraduate students in two samples (273 university students plus 152 students recruited via Mechanical Turk)."
  durationLabel: Single assessment
  aggregateRole: context
  notes:
  - "Directness classification: same_mechanism."
  - "Protocol claim-use classification: context-only."
  - "Discovery shards: in-bed-bedroom-device. Year(s): 2019. Candidate rationale: Notification-specific source for the alert/notification-disruption endpoint, although not an intervention."
sourceContext:
  evidenceBucket: in_bed_bedroom_device_timing
  directness: same_mechanism
  claimUse: context-only
  priority: high
  batchId: batch-004
  ledgerStudyDesign: cross_sectional
  canonicalIdBasis: doi
  artifactRightsStatusGuess: permission_required
  needsSourcePage: true
  needsArtifactManifestEntry: false
---

# Nighttime Notifications and Compulsivity Illuminate the Link Between Emerging Adults' Cellphone Use and Sleep-Related Problems
## Extraction boundary
- **Directness to Digital Sunset No Personal Screens Before Bed:** `same_mechanism`.
- **Claim-use boundary:** `context-only`. Observational/context findings should not be written as causal intervention claims.
- **Artifact handling:** metadata/link only unless rights review explicitly clears redistribution.

## Population and design
- **Design:** Cross-sectional survey in two emerging-adult samples.
- **Participants:** 425 (two_samples_total); Emerging adults/undergraduate students in two samples (273 university students plus 152 students recruited via Mechanical Turk).
- **Duration/follow-up:** Single assessment.

## Exposure and comparator
- **Exposure:** Nighttime cellphone notifications, overall cellphone use, and compulsive cellphone use.
- **Comparator/control:** Lower nighttime notifications/compulsivity and overall use within regression models.

## Endpoints
- Sleep-related problems
- Daytime sleepiness

## Extracted result
Nighttime notifications and compulsive cellphone use predicted sleep-related problems and daytime sleepiness after accounting for overall cellphone use in both samples; overall call/text quantity was less informative than nighttime/compulsive use.

## Safety/adverse events
No intervention adverse events reported.

## Limitations and population mismatch
- Cross-sectional observational design; no causal inference.
- Emerging-adult/student samples may not generalize to all adults or adolescents.
- Source informs notification mechanism, not a no-personal-screens-before-bed intervention.

## Protocol-page use note
Context-only observational evidence; it does not test Digital Sunset. Any future protocol-page claim using this source should cite `source_artifact:doi-10.1037/ppm0000156` and preserve the `context-only` boundary.

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
