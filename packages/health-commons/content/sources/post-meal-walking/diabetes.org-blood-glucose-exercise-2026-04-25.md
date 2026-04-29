---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:diabetes.org-blood-glucose-exercise-2026-04-25
slug: sources/post-meal-walking/diabetes.org-blood-glucose-exercise-2026-04-25
title: Understanding Your Blood Sugar and Exercise
summary: Not efficacy evidence; provides safety workflow for preventing and treating exercise-related hypoglycemia.
status: draft
quality: usable
aliases:
- Understanding Your Blood Sugar and Exercise
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
  kind: web_page
  title: Understanding Your Blood Sugar and Exercise
  authors: American Diabetes Association
  year: 2026
  journal: American Diabetes Association
  citation: American Diabetes Association. Understanding Your Blood Sugar and Exercise. Accessed 2026-04-25.
  url: https://diabetes.org/health-wellness/fitness/blood-glucose-and-exercise
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://diabetes.org/health-wellness/fitness/blood-glucose-and-exercise
  canonicalUrl: https://diabetes.org/health-wellness/fitness/blood-glucose-and-exercise
  identityAliases:
  - Understanding Your Blood Sugar and Exercise
researchEvidence:
  designKind: guideline
  designLabel: Consumer-facing blood glucose and exercise safety guidance
  populationLabel: People with diabetes, especially people taking insulin or insulin secretagogues.
  durationLabel: During and after physical activity; delayed lows may occur long after activity.
  aggregateRole: synthesis
  cohortKey: cohort:diabetes.org-blood-glucose-exercise-2026-04-25
  notes:
  - Consumer guidance, not a trial.
  - Does not specify an after-every-meal walking dose.
  - Medication adjustments require care-team input.
evidenceBucket: safety-guidelines-medication-boundaries
whyItMatters: The page translates professional hypoglycemia safety concepts into accessible user-facing actions needed for meal-timed walking.
potentialMurphEndpoints:
- Hypoglycemia prevention
- Pre-exercise glucose checks
- Carbohydrate treatment
- Medication adjustment boundary
protocolTakeaway: 'Include a clear “insulin/secretagogue users: check glucose and work with your diabetes team” boundary; do not give medication-adjustment instructions.'
murphTakeaway: Prompt users to log pre/post walk glucose, symptoms, rescue carbs, medication class, and delayed lows.
studyDesign: other
modality: consumer blood glucose and exercise safety guidance
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: unknown
sourceFindings:
-
  findingId: finding:walking-after-every-meal:diabetes.org-blood-glucose-exercise-2026-04-25:001
  sourceKey: source_artifact:diabetes.org-blood-glucose-exercise-2026-04-25
  findingKind: safety
  population: People with diabetes, especially people taking insulin or insulin secretagogues.
  exposure: Physical activity in people with diabetes.
  outcome: Exercise-related hypoglycemia.
  summary: The ADA blood-glucose/exercise page supports a protocol safety note that medicated diabetes users should check glucose, carry/treat with fast-acting carbohydrate, and coordinate medication or snack changes with their care team.
  evidenceUse:
  - safety
---
This source is included for **safety-guidelines-medication-boundaries**.

**Findings:** Not efficacy evidence; provides safety workflow for preventing and treating exercise-related hypoglycemia.

**Why it matters:** The page translates professional hypoglycemia safety concepts into accessible user-facing actions needed for meal-timed walking.

**Potential experiment signals:** Hypoglycemia prevention, Pre-exercise glucose checks, Carbohydrate treatment, Medication adjustment boundary.

**Protocol takeaway:** Include a clear “insulin/secretagogue users: check glucose and work with your diabetes team” boundary; do not give medication-adjustment instructions.

**Claim use:** `safety-only`.

## Extraction details

- **Population:** People with diabetes, especially people taking insulin or insulin secretagogues.
- **Participant count:** Not extracted/not applicable (not extracted/not applicable).
- **Intervention/exposure:** Blood glucose monitoring and treatment guidance around physical activity.
- **Comparator/control:** Not applicable.
- **Duration/follow-up:** During and after physical activity; delayed lows may occur long after activity.
- **Endpoints:** Hypoglycemia prevention, Pre-exercise glucose checks, Carbohydrate treatment, Medication adjustment boundary
- **Effect estimates or direction:** Not efficacy evidence; provides safety workflow for preventing and treating exercise-related hypoglycemia.
- **Adverse events/safety notes:** People taking insulin or insulin secretagogues are at risk for hypoglycemia if insulin dose or carbohydrate intake is not adjusted; lows can occur during or long after activity.
- **Limitations:** Consumer guidance, not a trial; Does not specify an after-every-meal walking dose; Medication adjustments require care-team input.
- **Population mismatch:** General diabetes exercise safety, not a direct post-meal walking protocol.
- **Directness to Walking After Every Meal:** safety_boundary / general_guideline.
- **Artifact candidates and rights:** unknown; no copyrighted PDF is vendored in Git by this extraction.

## Atomic finding links

- `finding:walking-after-every-meal:diabetes.org-blood-glucose-exercise-2026-04-25:001`
