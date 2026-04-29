---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:healthgov-physical-activity-guidelines-americans-2018-11-12
slug: sources/daily-step-floor/healthgov-physical-activity-guidelines-americans-2018-11-12
title: Physical Activity Guidelines for Americans, 2nd edition
summary: U.S. national physical-activity guideline giving time- and intensity-based recommendations for multiple populations; useful context but not evidence for a specific daily step floor.
status: draft
quality: usable
aliases:
- HHS 2018 Physical Activity Guidelines for Americans, 2nd edition
- healthgov-physical-activity-guidelines-americans-2018-11-12
categories:
- daily-step-floor
relations:
- type: duplicate_source_identity
  target: source_artifact:health.gov-physical-activity-guidelines-2018-11-12
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: guideline
  title: Physical Activity Guidelines for Americans, 2nd edition
  authors: U.S. Department of Health and Human Services
  year: 2018
  journal: U.S. Department of Health and Human Services
  url: https://odphp.health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf
  citation: 'U.S. Department of Health and Human Services. Physical Activity Guidelines for Americans, 2nd edition. Washington, DC: U.S. Department of Health and Human Services; 2018.'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: url
  identifiers:
    titleHash: f4b597e97f046a152d69bfe734ed1dfbf3d986f22f9199a472c4c7d63dd9aaf3
    url: https://odphp.health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf
  canonicalUrl: https://odphp.health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf
researchEvidence:
  designKind: guideline
  designLabel: National physical activity guideline
  populationLabel: People aged 3 years and older in the United States, including adults, older adults, children, adolescents, pregnant and postpartum women, and people with chronic conditions or disabilities.
  durationLabel: Not applicable; guideline document.
  cohortKey: cohort:daily-step-floor/healthgov-physical-activity-guidelines-americans-2018-11-12
  aggregateRole: primary
evidenceBucket: guidelines_external_protocol_context
whyItMatters: Sets the general public-health activity backdrop for a step-floor experiment while making clear that official guidance is not a step-count prescription.
potentialMurphEndpoints:
- physical_activity_minutes
- sedentary_time
- muscle_strengthening
- daily_step_count
protocolTakeaway: Use as context-only evidence for general activity targets and safety framing; do not cite as direct support for a daily minimum step count.
murphTakeaway: A step-floor page can map steps to broader activity guidance, but should not imply that HHS prescribes a specific step floor.
studyDesign: guideline
modality: physical_activity_guideline_context
claimUse: context-only
sourceFindings:
- findingId: finding:daily-step-floor/healthgov-physical-activity-guidelines-americans-2018-11-12/context
  sourceKey: source_artifact:healthgov-physical-activity-guidelines-americans-2018-11-12
  extractedFromArtifactId: art_healthgov_physical_activity_guidelines_americans_2018_11_12_source_extract
  findingKind: context
  population: People aged 3 years and older in the United States, including adults, older adults, children, adolescents, pregnant and postpartum women, and people with chronic conditions or disabilities.
  exposure: Time- and intensity-based physical activity guidance, muscle-strengthening guidance, balance guidance for older adults, and sedentary-behaviour reduction advice; not a step-count intervention.
  outcome: physical activity minutes; activity intensity; muscle-strengthening activity; sedentary behaviour; health outcomes considered by the guideline evidence review
  summary: The 2018 HHS guideline frames physical activity by weekly minutes, intensity, strengthening, balance, and sedentary behaviour rather than by a daily step-count floor.
  evidenceUse:
  - context
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **guidelines_external_protocol_context**.

**Findings:** The 2018 HHS guideline frames physical activity by weekly minutes, intensity, strengthening, balance, and sedentary behaviour rather than by a daily step-count floor.

**Why it matters:** Sets the general public-health activity backdrop for a step-floor experiment while making clear that official guidance is not a step-count prescription.

**Potential experiment signals:** physical_activity_minutes, sedentary_time, muscle_strengthening, daily_step_count.

**Protocol takeaway:** Use as context-only evidence for general activity targets and safety framing; do not cite as direct support for a daily minimum step count.

**Claim use:** `context-only`.

## Extraction notes

- **Population:** People aged 3 years and older in the United States, including adults, older adults, children, adolescents, pregnant and postpartum women, and people with chronic conditions or disabilities.
- **Exposure/intervention:** Time- and intensity-based physical activity guidance, muscle-strengthening guidance, balance guidance for older adults, and sedentary-behaviour reduction advice; not a step-count intervention.
- **Comparator/control:** No comparator or control group; guideline document.
- **Duration/follow-up:** Not applicable; guideline document.
- **Endpoints:** physical activity minutes; activity intensity; muscle-strengthening activity; sedentary behaviour; health outcomes considered by the guideline evidence review
- **Effect estimates or direction:** Provides general public-health recommendations such as moving more and sitting less and accumulating recommended aerobic and strengthening activity; it does not test or prescribe a Daily Step Floor.
- **Adverse events/safety notes:** General safety guidance is embedded in population-specific recommendations; no trial adverse-event data are reported.
- **Limitations:** Guideline context only; recommendations are not expressed as a daily step floor and are not a source-specific intervention outcome.
- **Population mismatch:** General guideline for broad public-health populations, not a trial of a wearable-tracked daily minimum step protocol.
- **Artifact rights:** open_access
