---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:american-diabetes-association-standards-care-2026-2025-12-08
slug: sources/post-meal-walking/american-diabetes-association-standards-care-2026-2025-12-08
title: Standards of Care in Diabetes—2026
summary: Not an intervention study; use as current clinical boundary rather than efficacy evidence for post-meal walking.
status: draft
quality: usable
aliases:
- Standards of Care in Diabetes—2026
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
  kind: guideline
  title: Standards of Care in Diabetes—2026
  authors: American Diabetes Association Professional Practice Committee
  year: 2026
  journal: Diabetes Care
  citation: American Diabetes Association Professional Practice Committee. Standards of Care in Diabetes—2026. Diabetes Care. 2026;49(Suppl 1).
  url: https://diabetesjournals.org/care/issue/49/Supplement_1
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    url: https://diabetesjournals.org/care/issue/49/Supplement_1
  canonicalUrl: https://diabetesjournals.org/care/issue/49/Supplement_1
  identityAliases:
  - Standards of Care in Diabetes—2026
researchEvidence:
  designKind: guideline
  designLabel: Current professional diabetes standards issue
  populationLabel: Children, adolescents, and adults with diabetes or prediabetes; professional clinical guidance context.
  durationLabel: Current 2026 annual standards; living updates may occur during the year.
  aggregateRole: synthesis
  cohortKey: cohort:american-diabetes-association-standards-care-2026-2025-12-08
  notes:
  - Issue-level source rather than a trial.
  - Not specific to walking after each meal.
  - Guideline recommendations need section-level extraction before being used as precise clinical instructions.
evidenceBucket: safety-guidelines-medication-boundaries
whyItMatters: Current ADA standards are the highest-level diabetes-care context for preventing protocol language from overriding individualized medical care, medications, or complication screening.
potentialMurphEndpoints:
- Hypoglycemia risk management
- Glucose-lowering medication boundaries
- Physical activity counseling context
- Diabetes complications and technology guidance
protocolTakeaway: Use the 2026 Standards only as a safety and clinician-guidance boundary; do not frame after-meal walking as a medication substitute.
murphTakeaway: Surface diabetes medication, CGM/SMBG, and complication prompts before inviting medicated users into a meal-timed walking experiment.
studyDesign: guideline
modality: professional diabetes standards
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: unknown
sourceFindings:
-
  findingId: finding:walking-after-every-meal:american-diabetes-association-standards-care-2026-2025-12-08:001
  sourceKey: source_artifact:american-diabetes-association-standards-care-2026-2025-12-08
  findingKind: safety
  population: Children, adolescents, and adults with diabetes or prediabetes; professional clinical guidance context.
  exposure: Professional diabetes standards of care.
  outcome: Medication, technology, complication, and hypoglycemia safety boundaries.
  summary: The ADA Standards of Care in Diabetes—2026 should be used to keep after-meal walking advice subordinate to individualized diabetes care, medications, technology, and complication management.
  evidenceUse:
  - safety
---
This source is included for **safety-guidelines-medication-boundaries**.

**Findings:** Not an intervention study; use as current clinical boundary rather than efficacy evidence for post-meal walking.

**Why it matters:** Current ADA standards are the highest-level diabetes-care context for preventing protocol language from overriding individualized medical care, medications, or complication screening.

**Potential experiment signals:** Hypoglycemia risk management, Glucose-lowering medication boundaries, Physical activity counseling context, Diabetes complications and technology guidance.

**Protocol takeaway:** Use the 2026 Standards only as a safety and clinician-guidance boundary; do not frame after-meal walking as a medication substitute.

**Claim use:** `safety-only`.

## Extraction details

- **Population:** Children, adolescents, and adults with diabetes or prediabetes; professional clinical guidance context.
- **Participant count:** Not extracted/not applicable (not extracted/not applicable).
- **Intervention/exposure:** Annual evidence-based standards covering diagnosis, management, medications, technology, complications, behavior, and safety.
- **Comparator/control:** Not applicable.
- **Duration/follow-up:** Current 2026 annual standards; living updates may occur during the year.
- **Endpoints:** Hypoglycemia risk management, Glucose-lowering medication boundaries, Physical activity counseling context, Diabetes complications and technology guidance
- **Effect estimates or direction:** Not an intervention study; use as current clinical boundary rather than efficacy evidence for post-meal walking.
- **Adverse events/safety notes:** The standards synthesize professional guidance for diabetes care, including medication, technology, complications, and hypoglycemia-related boundaries.
- **Limitations:** Issue-level source rather than a trial; Not specific to walking after each meal; Guideline recommendations need section-level extraction before being used as precise clinical instructions.
- **Population mismatch:** Broad diabetes-care guidance; applies as safety context, not as direct protocol evidence.
- **Directness to Walking After Every Meal:** safety_boundary / general_guideline.
- **Artifact candidates and rights:** unknown; no copyrighted PDF is vendored in Git by this extraction.

## Atomic finding links

- `finding:walking-after-every-meal:american-diabetes-association-standards-care-2026-2025-12-08:001`
