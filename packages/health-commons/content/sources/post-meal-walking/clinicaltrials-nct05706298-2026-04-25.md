---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct05706298-2026-04-25
slug: sources/post-meal-walking/clinicaltrials-nct05706298-2026-04-25
title: Active Breaks in People With Type 1 Diabetes
summary: No outcome results; registration/protocol-only evidence.
status: draft
quality: usable
aliases:
- NCT05706298
- Active Breaks in People With Type 1 Diabetes
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
  title: Active Breaks in People With Type 1 Diabetes
  authors: University of Birmingham and EXTOD-Active investigators
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Active Breaks in People With Type 1 Diabetes. Identifier NCT05706298. Accessed 2026-04-25.
  url: https://clinicaltrials.gov/study/NCT05706298
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT05706298
    url: https://clinicaltrials.gov/study/NCT05706298
  canonicalUrl: https://clinicaltrials.gov/study/NCT05706298
  identityAliases:
  - NCT05706298
researchEvidence:
  designKind: other
  designLabel: Trial registration for active-break randomized controlled trial
  populationLabel: Sedentary adults with type 1 diabetes targeted for a real-world active-break intervention.
  durationLabel: Planned 7-day baseline plus 4-week intervention.
  aggregateRole: primary
  cohortKey: cohort:clinicaltrials-nct05706298-2026-04-25
  notes:
  - Trial registration/protocol only.
  - No completed results extracted.
  - Active breaks are not an after-every-meal walking protocol.
  participantCount: 118
  participantCountKind: reported
evidenceBucket: safety-guidelines-medication-boundaries
whyItMatters: 'This registry record tracks a near-term evidence gap: whether real-world walking breaks in type 1 diabetes improve CGM time-in-range without creating medication-safety problems.'
potentialMurphEndpoints:
- Time in target glucose range
- Continuous glucose monitoring metrics
- Activity levels
- Insulin dose
- Carbohydrate intake
protocolTakeaway: Use only for future-tracking and safety instrumentation ideas; do not cite as evidence that post-meal walking works or is safe in type 1 diabetes.
murphTakeaway: For type 1 diabetes users, any active-break experiment should capture CGM time-in-range, insulin dose, carbohydrate intake, and hypoglycemia events.
studyDesign: interventional_trial_registration
modality: trial registration; self-paced walking active breaks
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: unknown
sourceFindings:
-
  findingId: finding:walking-after-every-meal:clinicaltrials-nct05706298-2026-04-25:001
  sourceKey: source_artifact:clinicaltrials-nct05706298-2026-04-25
  findingKind: safety
  population: Sedentary adults with type 1 diabetes targeted for a real-world active-break intervention.
  exposure: 3-minute self-paced walking breaks every 30 minutes during the prescribed daytime window.
  outcome: Time in range and CGM-derived glycemic management.
  summary: The NCT05706298 registration describes a planned real-world active-break intervention in type 1 diabetes, but it does not provide outcome evidence for after-meal walking.
  evidenceUse:
  - safety
---
This source is included for **safety-guidelines-medication-boundaries**.

**Findings:** No outcome results; registration/protocol-only evidence.

**Why it matters:** This registry record tracks a near-term evidence gap: whether real-world walking breaks in type 1 diabetes improve CGM time-in-range without creating medication-safety problems.

**Potential experiment signals:** Time in target glucose range, Continuous glucose monitoring metrics, Activity levels, Insulin dose, Carbohydrate intake.

**Protocol takeaway:** Use only for future-tracking and safety instrumentation ideas; do not cite as evidence that post-meal walking works or is safe in type 1 diabetes.

**Claim use:** `safety-only`.

## Extraction details

- **Population:** Sedentary adults with type 1 diabetes targeted for a real-world active-break intervention.
- **Participant count:** 118 (reported).
- **Intervention/exposure:** Active breaks: 3 minutes of self-paced walking every 30 minutes during a daytime work-window schedule.
- **Comparator/control:** Habitual lifestyle/control arm.
- **Duration/follow-up:** Planned 7-day baseline plus 4-week intervention.
- **Endpoints:** Time in target glucose range, Continuous glucose monitoring metrics, Activity levels, Insulin dose, Carbohydrate intake
- **Effect estimates or direction:** No outcome results; registration/protocol-only evidence.
- **Adverse events/safety notes:** Relevant because the registration includes insulin and carbohydrate monitoring for type 1 diabetes active-break implementation.
- **Limitations:** Trial registration/protocol only; No completed results extracted; Active breaks are not an after-every-meal walking protocol.
- **Population mismatch:** Adjacent active-break protocol in type 1 diabetes; meal timing is not the central intervention.
- **Directness to Walking After Every Meal:** safety_boundary / measurement_context.
- **Artifact candidates and rights:** unknown; no copyrighted PDF is vendored in Git by this extraction.

## Atomic finding links

- `finding:walking-after-every-meal:clinicaltrials-nct05706298-2026-04-25:001`
