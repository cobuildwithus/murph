---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:diabetes.org-exercise-type-1-2026-04-25
slug: sources/post-meal-walking/diabetes.org-exercise-type-1-2026-04-25
title: Exercise & Type 1
summary: Not efficacy evidence; type 1 diabetes safety guidance.
status: draft
quality: usable
aliases:
- Exercise & Type 1
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
  title: Exercise & Type 1
  authors: American Diabetes Association
  year: 2026
  journal: American Diabetes Association
  citation: American Diabetes Association. Exercise & Type 1. Accessed 2026-04-25.
  url: https://diabetes.org/health-wellness/fitness/exercise-and-type-1
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://diabetes.org/health-wellness/fitness/exercise-and-type-1
  canonicalUrl: https://diabetes.org/health-wellness/fitness/exercise-and-type-1
  identityAliases:
  - Exercise & Type 1
researchEvidence:
  designKind: guideline
  designLabel: Consumer-facing type 1 diabetes exercise safety guidance
  populationLabel: People with type 1 diabetes, including children and adolescents.
  durationLabel: Before, during, and after activity.
  aggregateRole: synthesis
  cohortKey: cohort:diabetes.org-exercise-type-1-2026-04-25
  notes:
  - Consumer guidance, not a trial.
  - No specific after-meal walking dose.
  - Individual insulin adjustments require clinician guidance.
evidenceBucket: safety-guidelines-medication-boundaries
whyItMatters: Type 1 diabetes is the population in which “just walk after meals” can be unsafe if insulin, carbohydrate, and current glucose are ignored.
potentialMurphEndpoints:
- Hypoglycemia prevention
- Hyperglycemia and ketone precautions
- Carbohydrate rescue
- Insulin pump basal adjustment boundary
protocolTakeaway: Do not present after-meal walking as universally simple for type 1 diabetes; require individualized glucose/insulin planning.
murphTakeaway: Collect medication/pump status, CGM trend, pre-walk glucose, ketones if high, carbohydrate rescue, and delayed lows.
studyDesign: other
modality: consumer type 1 diabetes exercise safety guidance
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: unknown
sourceFindings:
-
  findingId: finding:walking-after-every-meal:diabetes.org-exercise-type-1-2026-04-25:001
  sourceKey: source_artifact:diabetes.org-exercise-type-1-2026-04-25
  findingKind: safety
  population: People with type 1 diabetes, including children and adolescents.
  exposure: Exercise or daily activity in type 1 diabetes.
  outcome: Low and high glucose prevention.
  summary: 'The ADA type 1 page supports a strong protocol boundary: type 1 diabetes users need individualized insulin, carbohydrate, glucose, and ketone planning before meal-timed walking.'
  evidenceUse:
  - safety
---
This source is included for **safety-guidelines-medication-boundaries**.

**Findings:** Not efficacy evidence; type 1 diabetes safety guidance.

**Why it matters:** Type 1 diabetes is the population in which “just walk after meals” can be unsafe if insulin, carbohydrate, and current glucose are ignored.

**Potential experiment signals:** Hypoglycemia prevention, Hyperglycemia and ketone precautions, Carbohydrate rescue, Insulin pump basal adjustment boundary.

**Protocol takeaway:** Do not present after-meal walking as universally simple for type 1 diabetes; require individualized glucose/insulin planning.

**Claim use:** `safety-only`.

## Extraction details

- **Population:** People with type 1 diabetes, including children and adolescents.
- **Participant count:** Not extracted/not applicable (not extracted/not applicable).
- **Intervention/exposure:** Planning exercise around insulin, carbohydrate intake, activity intensity, and glucose monitoring.
- **Comparator/control:** Not applicable.
- **Duration/follow-up:** Before, during, and after activity.
- **Endpoints:** Hypoglycemia prevention, Hyperglycemia and ketone precautions, Carbohydrate rescue, Insulin pump basal adjustment boundary
- **Effect estimates or direction:** Not efficacy evidence; type 1 diabetes safety guidance.
- **Adverse events/safety notes:** Emphasizes balancing insulin, food, and activity; checking glucose before/during/after exercise; taking carbohydrate when pre-exercise glucose is low; and avoiding vigorous activity when ketones are present.
- **Limitations:** Consumer guidance, not a trial; No specific after-meal walking dose; Individual insulin adjustments require clinician guidance.
- **Population mismatch:** Type 1 diabetes safety boundary; not direct protocol evidence for general users.
- **Directness to Walking After Every Meal:** safety_boundary / general_guideline.
- **Artifact candidates and rights:** unknown; no copyrighted PDF is vendored in Git by this extraction.

## Atomic finding links

- `finding:walking-after-every-meal:diabetes.org-exercise-type-1-2026-04-25:001`
