---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nice-ng3-diabetes-in-pregnancy-2015
slug: sources/post-meal-walking/nice-ng3-diabetes-in-pregnancy-2015
title: 'Diabetes in pregnancy: management from preconception to the postnatal period, NICE guideline NG3'
summary: NICE NG3 explicitly gives walking for 30 minutes after a meal as an example of regular exercise for gestational diabetes, while tying it to clinical glucose monitoring and medication escalation rules.
status: draft
quality: usable
aliases:
- NICE guideline NG3
- Diabetes in pregnancy NG3
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
  title: 'Diabetes in pregnancy: management from preconception to the postnatal period, NICE guideline NG3'
  authors: National Institute for Health and Care Excellence (NICE)
  year: 2015
  journal: NICE Guideline NG3
  citation: 'National Institute for Health and Care Excellence. Diabetes in pregnancy: management from preconception to the postnatal period. NICE guideline NG3. Published 2015; updated 2020. https://www.nice.org.uk/guidance/ng3/chapter/recommendations.'
  url: https://www.nice.org.uk/guidance/ng3/chapter/recommendations
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    url: https://www.nice.org.uk/guidance/ng3/chapter/recommendations
  canonicalUrl: https://www.nice.org.uk/guidance/ng3/chapter/recommendations
  identityAliases:
  - NICE guideline NG3
  - Diabetes in pregnancy NG3
researchEvidence:
  designKind: guideline
  designLabel: Professional clinical guideline
  populationLabel: Women with gestational diabetes or pre-existing diabetes in pregnancy.
  durationLabel: Preconception, antenatal, and postnatal management guidance.
  aggregateRole: context
  cohortKey: cohort:nice-ng3-diabetes-in-pregnancy-2015
  notes:
  - External professional guideline claim
  - Pregnancy/GDM population mismatch for routine adult protocol
  - Use as safety boundary and guideline context
evidenceBucket: safety-older-pregnancy-pediatric-hypotension
whyItMatters: NICE is a high-authority external guideline that explicitly names walking after a meal for GDM, while also emphasizing clinical monitoring and medication escalation.
potentialMurphEndpoints:
- post-meal capillary glucose
- fasting glucose
- hypoglycemia symptoms
- pregnancy clinician-clearance status
protocolTakeaway: 'Use for pregnancy/GDM safety and external-guideline context only: pregnant users should follow obstetric/diabetes care plans, not a generic wellness protocol.'
murphTakeaway: This is a named after-meal walking guideline signal for GDM, but not direct adult protocol efficacy evidence.
studyDesign: guideline
modality: gestational diabetes guideline; exercise and glucose monitoring
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **safety-older-pregnancy-pediatric-hypotension**.

**Findings:** NICE advises regular exercise for gestational diabetes, with walking 30 minutes after a meal as an example, while coupling this with glucose monitoring and medication escalation guidance.

**Why it matters:** NICE is a high-authority external guideline that explicitly names walking after a meal for GDM, while also emphasizing clinical monitoring and medication escalation.

**Potential experiment signals:** post-meal capillary glucose, fasting glucose, hypoglycemia symptoms, pregnancy clinician-clearance status.

**Protocol takeaway:** Use for pregnancy/GDM safety and external-guideline context only: pregnant users should follow obstetric/diabetes care plans, not a generic wellness protocol.

**Claim use:** `safety-only`.

## Extraction details

- **Population:** Women with gestational diabetes and pre-existing diabetes in pregnancy.
- **Participant count:** Not applicable; professional guideline.
- **Intervention/exposure:** Diet and exercise guidance for diabetes in pregnancy, including walking for 30 minutes after a meal as an example for gestational diabetes.
- **Comparator/control:** Clinical escalation to metformin and/or insulin if diet and exercise do not meet glucose targets.
- **Duration/follow-up:** Guideline management pathway across pregnancy; 1–2 week lifestyle trial before medication escalation in specified GDM situations.
- **Endpoints:** post-meal capillary glucose, fasting glucose, hypoglycemia symptoms, pregnancy clinician-clearance status
- **Effect estimates or direction:** Guideline-level recommendation; no effect estimate from a walking trial is provided by this source page.
- **Adverse events/safety notes:** Requires glucose monitoring and medication management; insulin-treated pregnant women have hypoglycemia risk.
- **Limitations:** Guideline rather than primary trial; Specific to pregnancy/GDM; Does not establish routine adult protocol efficacy
- **Population mismatch:** Safety-boundary evidence rather than routine adult/general wellness protocol evidence.
- **Directness to Walking After Every Meal:** safety_boundary
- **Artifact candidates and rights:** Rights status in the canonical ledger or extracted source metadata is `open_access`. Keep source-page metadata and external identifiers; do not add copyrighted publisher PDFs to Git unless redistribution rights are independently confirmed.

## Atomic finding links

- `finding:walking-after-every-meal:nice-ng3-diabetes-in-pregnancy-2015:001`
- `finding:walking-after-every-meal:nice-ng3-diabetes-in-pregnancy-2015:002`
