---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct06157684-2026-04-25
slug: sources/post-meal-walking/clinicaltrials-nct06157684-2026-04-25
title: Timing of Ambulation and Infant Birth Weight in Gestational Diabetes Mellitus
summary: ClinicalTrials.gov registry record for an open-label randomized pregnancy/GDM trial testing 20 minutes of postprandial ambulation after meals versus routine activity counseling, with infant birthweight percentile as the primary outcome. No efficacy results were extracted from the registry record.
status: draft
quality: usable
aliases:
- NCT06157684
- Assessment of Effect of Postprandial Ambulation on Birth Weight Percentile in Patients With GDM
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
  title: Timing of Ambulation and Infant Birth Weight in Gestational Diabetes Mellitus
  authors: Women and Infants Hospital of Rhode Island; Anna Whelan; Martha Kole-White
  year: 2023
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Timing of Ambulation and Infant Birth Weight in Gestational Diabetes Mellitus. NCT06157684. Accessed 2026-04-25.
  url: https://clinicaltrials.gov/study/NCT06157684
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT06157684
    url: https://clinicaltrials.gov/study/NCT06157684
  canonicalUrl: https://clinicaltrials.gov/study/NCT06157684
  identityAliases:
  - NCT06157684
  - Assessment of Effect of Postprandial Ambulation on Birth Weight Percentile in Patients With GDM
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Open-label randomized controlled trial registration
  participantCount: 90
  participantCountKind: reported
  populationLabel: Pregnant people with gestational diabetes mellitus in a maternal-fetal medicine diabetes-in-pregnancy program; excludes pre-existing type 1 or type 2 diabetes and people unable to ambulate.
  durationLabel: From GDM care/randomization through delivery; registry endpoints include delivery and neonatal outcomes.
  aggregateRole: primary
  cohortKey: cohort:clinicaltrials-nct06157684-gdm-pregnancy
evidenceBucket: clinical-supervised-population-boundaries
whyItMatters: This registration shows that after-meal walking is being tested prospectively in a monitored GDM pregnancy setting, but it should not be used as general-population efficacy evidence because results are not posted and the population is clinically distinct.
potentialMurphEndpoints:
- Infant birthweight percentile
- Need for metformin or insulin
- Mode of delivery
- Neonatal hypoglycemia
- Feasibility and acceptability
- Post-meal walking adherence
protocolTakeaway: 'Use as pregnancy/GDM context only: the trial operationalizes walking after meals, but it has no extracted outcome results and does not establish a general Walking After Every Meal effect.'
murphTakeaway: In pregnancy or GDM, after-meal walking should be framed as a clinician-supervised option, not a self-directed Murph claim.
studyDesign: randomized controlled trial registration
modality: postprandial ambulation / walking
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **clinical-supervised-population-boundaries**.

Source key for extracted claims on this page: `source_artifact:clinicaltrials-nct06157684-2026-04-25`.

## Findings
- The registry describes a randomized trial comparing routine exercise counseling with a recommendation for 20 minutes of walking after meals in pregnant people with GDM.
- Primary and secondary endpoints are pregnancy- and neonatal-specific, including infant birthweight percentile, medication escalation, delivery mode, neonatal hypoglycemia, feasibility, and acceptability.
- No posted outcome results were extracted; this source is a protocol/registry context source rather than efficacy evidence.

## Why it matters
This registration shows that after-meal walking is being tested prospectively in a monitored GDM pregnancy setting, but it should not be used as general-population efficacy evidence because results are not posted and the population is clinically distinct.

## Potential experiment signals
- Infant birthweight percentile
- Need for metformin or insulin
- Mode of delivery
- Neonatal hypoglycemia
- Feasibility and acceptability
- Post-meal walking adherence

## Protocol takeaway
Use as pregnancy/GDM context only: the trial operationalizes walking after meals, but it has no extracted outcome results and does not establish a general Walking After Every Meal effect.

## Claim use
`context-only`.

## Extraction details

- **Source kind:** trial_registry
- **Study design:** randomized controlled trial registration (Open-label randomized controlled trial registration)
- **Participant count:** 90 (reported)
- **Population:** Pregnant people with gestational diabetes mellitus in a maternal-fetal medicine diabetes-in-pregnancy program; excludes pre-existing type 1 or type 2 diabetes and people unable to ambulate.
- **Intervention or exposure:** 20 minutes of postprandial ambulation/walking after meals, with activity tracking in some registry/protocol descriptions.
- **Comparator or control:** Routine activity or routine exercise counseling.
- **Duration or follow-up:** From GDM care/randomization through delivery; registry endpoints include delivery and neonatal outcomes.
- **Endpoints:** Birthweight percentile, feasibility/acceptability, need for metformin/insulin, mode of delivery, neonatal hypoglycemia.
- **Effect estimates or direction:** No efficacy results posted/extracted.
- **Adverse events or safety notes:** Registry/protocol materials describe light walking as minimal risk in pregnancy; no adverse-event results were extracted.
- **Population mismatch:** Pregnant people with GDM under specialist care; not representative of general adults trying casual post-meal walks.
- **Directness to Walking After Every Meal:** clinical_supervised
- **Artifact candidates / rights:** ClinicalTrials.gov record and protocol metadata are public; no copyrighted PDF needs to be committed. `pdfRightsStatus=open_access`.

## Limitations
- Registry/protocol record only for this extraction.
- No posted efficacy outcomes.
- Pregnancy/GDM population and clinical eligibility criteria limit generalizability.
- Excludes pre-existing diabetes and people unable to ambulate.

## Atomic finding links
- `finding:walking-after-every-meal:clinicaltrials-nct06157684-2026-04-25:001`
- `finding:walking-after-every-meal:clinicaltrials-nct06157684-2026-04-25:002`
