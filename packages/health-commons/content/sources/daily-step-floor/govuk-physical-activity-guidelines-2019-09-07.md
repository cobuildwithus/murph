---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:govuk-physical-activity-guidelines-2019-09-07
slug: sources/daily-step-floor/govuk-physical-activity-guidelines-2019-09-07
title: UK Chief Medical Officers' Physical Activity Guidelines
summary: UK Chief Medical Officers guideline report on physical activity amount and type; context-only for Daily Step Floor.
status: draft
quality: usable
aliases:
- UK Chief Medical Officers' 2019 Physical Activity Guidelines
- govuk-physical-activity-guidelines-2019-09-07
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: guideline
  title: UK Chief Medical Officers' Physical Activity Guidelines
  authors: UK Chief Medical Officers; Department of Health and Social Care
  year: 2019
  journal: GOV.UK / Department of Health and Social Care
  url: https://www.gov.uk/government/publications/physical-activity-guidelines-uk-chief-medical-officers-report
  citation: UK Chief Medical Officers. UK Chief Medical Officers' Physical Activity Guidelines. Department of Health and Social Care; 2019.
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: url
  identifiers:
    titleHash: d221f5d80609c8355c984916c8e351a2684601a83362dae26c9639e66818c286
    url: https://www.gov.uk/government/publications/physical-activity-guidelines-uk-chief-medical-officers-report
  canonicalUrl: https://www.gov.uk/government/publications/physical-activity-guidelines-uk-chief-medical-officers-report
researchEvidence:
  designKind: guideline
  designLabel: National physical activity guideline
  populationLabel: UK population groups addressed by the Chief Medical Officers, including children, adults, older adults, pregnant/postpartum women, and disabled adults.
  durationLabel: Not applicable; guideline report.
  cohortKey: cohort:daily-step-floor/govuk-physical-activity-guidelines-2019-09-07
  aggregateRole: primary
evidenceBucket: guidelines_external_protocol_context
whyItMatters: Adds non-U.S. official guideline context while preserving that official guidance is not equivalent to a specific step floor.
potentialMurphEndpoints:
- physical_activity_minutes
- sedentary_time
- muscle_strengthening
- daily_step_count
protocolTakeaway: Use as context-only official guideline evidence; do not cite as direct support for a daily step minimum.
murphTakeaway: The protocol can cite UK guidance for general activity framing but should keep step targets as implementation choices.
studyDesign: guideline
modality: physical_activity_guideline_context
claimUse: context-only
sourceFindings:
- findingId: finding:daily-step-floor/govuk-physical-activity-guidelines-2019-09-07/context
  sourceKey: source_artifact:govuk-physical-activity-guidelines-2019-09-07
  extractedFromArtifactId: art_govuk_physical_activity_guidelines_2019_09_07_source_extract
  findingKind: context
  population: UK population groups addressed by the Chief Medical Officers, including children, adults, older adults, pregnant/postpartum women, and disabled adults.
  exposure: UK physical activity recommendations on amount and type of activity for health; not a daily step-count floor.
  outcome: physical activity amount and type; muscle and bone strengthening; sedentary behaviour; public-health guidance
  summary: The UK CMO guideline report provides public-health recommendations on the amount and type of activity people should do for health, but does not evaluate a daily step-floor protocol.
  evidenceUse:
  - context
  - safety
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **guidelines_external_protocol_context**.

**Findings:** The UK CMO guideline report provides public-health recommendations on the amount and type of activity people should do for health, but does not evaluate a daily step-floor protocol.

**Why it matters:** Adds non-U.S. official guideline context while preserving that official guidance is not equivalent to a specific step floor.

**Potential experiment signals:** physical_activity_minutes, sedentary_time, muscle_strengthening, daily_step_count.

**Protocol takeaway:** Use as context-only official guideline evidence; do not cite as direct support for a daily step minimum.

**Claim use:** `context-only`.

## Extraction notes

- **Population:** UK population groups addressed by the Chief Medical Officers, including children, adults, older adults, pregnant/postpartum women, and disabled adults.
- **Exposure/intervention:** UK physical activity recommendations on amount and type of activity for health; not a daily step-count floor.
- **Comparator/control:** No comparator or control group; guideline report.
- **Duration/follow-up:** Not applicable; guideline report.
- **Endpoints:** physical activity amount and type; muscle and bone strengthening; sedentary behaviour; public-health guidance
- **Effect estimates or direction:** Provides official UK physical-activity guidance for health benefits; no Daily Step Floor intervention result is reported.
- **Adverse events/safety notes:** Guideline-level safety and population-specific advice; no trial adverse-event dataset.
- **Limitations:** Guideline context only; does not test or prescribe a Murph-style daily step floor.
- **Population mismatch:** General UK public-health guidance, not a personal wearable-tracked step-floor protocol.
- **Artifact rights:** open_access
