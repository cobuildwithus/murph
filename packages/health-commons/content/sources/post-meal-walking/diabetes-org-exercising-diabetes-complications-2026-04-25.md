---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:diabetes-org-exercising-diabetes-complications-2026-04-25
slug: sources/post-meal-walking/diabetes-org-exercising-diabetes-complications-2026-04-25
title: Exercising With Diabetes Complications
summary: Not efficacy evidence; lists activities to avoid or prefer by complication type.
status: draft
quality: usable
aliases:
- Exercising With Diabetes Complications
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
  title: Exercising With Diabetes Complications
  authors: American Diabetes Association
  year: 2026
  journal: American Diabetes Association
  citation: American Diabetes Association. Exercising With Diabetes Complications. Accessed 2026-04-25.
  url: https://diabetes.org/health-wellness/fitness/exercising-diabetes-complications
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://diabetes.org/health-wellness/fitness/exercising-diabetes-complications
  canonicalUrl: https://diabetes.org/health-wellness/fitness/exercising-diabetes-complications
  identityAliases:
  - Exercising With Diabetes Complications
researchEvidence:
  designKind: guideline
  designLabel: Consumer-facing diabetes complication exercise guidance
  populationLabel: People with diabetes complications such as heart disease, high blood pressure, nephropathy, peripheral neuropathy, autonomic neuropathy, retinopathy, peripheral vascular disease, osteoporosis, or arthritis.
  durationLabel: Not applicable.
  aggregateRole: synthesis
  cohortKey: cohort:diabetes-org-exercising-diabetes-complications-2026-04-25
  notes:
  - Consumer guidance, not a trial.
  - Does not evaluate post-meal walking outcomes.
  - Needs clinical tailoring for individual complications.
evidenceBucket: safety-guidelines-medication-boundaries
whyItMatters: Walking is often framed as low-risk, but diabetes complications can change what “safe walking” means.
potentialMurphEndpoints:
- Foot injury risk
- Neuropathy precautions
- Retinopathy precautions
- Cardiovascular strain precautions
- Walking suitability
protocolTakeaway: 'Add complication-specific cautions: foot ulcers, neuropathy, retinopathy, autonomic neuropathy, and heart disease may require modified or clinician-approved activity.'
murphTakeaway: Ask users with neuropathy, foot ulcers, retinopathy, fainting risk, or cardiac disease to choose safer variants or consult their care team.
studyDesign: guideline
modality: consumer safety guidance for exercise with diabetes complications
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: open_access
sourceFindings:
-
  findingId: finding:walking-after-every-meal:diabetes-org-exercising-diabetes-complications-2026-04-25:001
  sourceKey: source_artifact:diabetes-org-exercising-diabetes-complications-2026-04-25
  findingKind: safety
  population: People with diabetes complications such as heart disease, high blood pressure, nephropathy, peripheral neuropathy, autonomic neuropathy, retinopathy, peripheral vascular disease, osteoporosis, or arthritis.
  exposure: Walking or other moderate activity in people with diabetes complications.
  outcome: Foot, neuropathy, retinopathy, cardiovascular, and vascular safety.
  summary: The ADA complications page supports adding a walking-specific diabetes complication screen, especially for neuropathy, footwear, foot checks, ulcers, retinopathy, autonomic neuropathy, and heart disease.
  evidenceUse:
  - safety
---
This source is included for **safety-guidelines-medication-boundaries**.

**Findings:** Not efficacy evidence; lists activities to avoid or prefer by complication type.

**Why it matters:** Walking is often framed as low-risk, but diabetes complications can change what “safe walking” means.

**Potential experiment signals:** Foot injury risk, Neuropathy precautions, Retinopathy precautions, Cardiovascular strain precautions, Walking suitability.

**Protocol takeaway:** Add complication-specific cautions: foot ulcers, neuropathy, retinopathy, autonomic neuropathy, and heart disease may require modified or clinician-approved activity.

**Claim use:** `safety-only`.

## Extraction details

- **Population:** People with diabetes complications such as heart disease, high blood pressure, nephropathy, peripheral neuropathy, autonomic neuropathy, retinopathy, peripheral vascular disease, osteoporosis, or arthritis.
- **Participant count:** Not extracted/not applicable (not extracted/not applicable).
- **Intervention/exposure:** Exercise selection and modification guidance for specific diabetes complications.
- **Comparator/control:** Not applicable.
- **Duration/follow-up:** Not applicable.
- **Endpoints:** Foot injury risk, Neuropathy precautions, Retinopathy precautions, Cardiovascular strain precautions, Walking suitability
- **Effect estimates or direction:** Not efficacy evidence; lists activities to avoid or prefer by complication type.
- **Adverse events/safety notes:** Warns against strenuous/prolonged weight-bearing walking with peripheral neuropathy or active foot injury/ulcer and emphasizes footwear and daily foot checks.
- **Limitations:** Consumer guidance, not a trial; Does not evaluate post-meal walking outcomes; Needs clinical tailoring for individual complications.
- **Population mismatch:** Directly relevant to safety screening, not direct protocol efficacy.
- **Directness to Walking After Every Meal:** safety_boundary / general_guideline.
- **Artifact candidates and rights:** open_access; no copyrighted PDF is vendored in Git by this extraction.

## Atomic finding links

- `finding:walking-after-every-meal:diabetes-org-exercising-diabetes-complications-2026-04-25:001`
