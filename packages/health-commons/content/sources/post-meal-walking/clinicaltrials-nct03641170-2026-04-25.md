---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct03641170-2026-04-25
slug: sources/post-meal-walking/clinicaltrials-nct03641170-2026-04-25
title: The Acute Effect of Physical Activity on Postprandial Blood Glucose in Women With Gestational Diabetes Mellitus
summary: ClinicalTrials.gov registration linked to the Andersen gestational-diabetes interval-walking study, documenting an acute physical-activity study in pregnant women with GDM. The registry is useful for protocol lineage and registration details, while outcome interpretation belongs to the companion publication.
status: draft
quality: usable
aliases:
- NCT03641170
- Acute physical activity and postprandial blood glucose in pregnant women with GDM
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
  title: The Acute Effect of Physical Activity on Postprandial Blood Glucose in Women With Gestational Diabetes Mellitus
  authors: Aarhus University; Mette B. Andersen and colleagues
  year: 2018
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. The Acute Effect of Physical Activity on Postprandial Blood Glucose in Women With Gestational Diabetes Mellitus. NCT03641170. Accessed 2026-04-25.
  url: https://clinicaltrials.gov/study/NCT03641170
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT03641170
    url: https://clinicaltrials.gov/study/NCT03641170
  canonicalUrl: https://clinicaltrials.gov/study/NCT03641170
  identityAliases:
  - NCT03641170
  - Acute physical activity and postprandial blood glucose in pregnant women with GDM
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Registered acute crossover clinical study
  participantCount: 14
  participantCountKind: reported
  populationLabel: Pregnant women with gestational diabetes mellitus.
  durationLabel: Acute/short crossover study registration; companion publication used four-day intervention and control periods.
  aggregateRole: primary
  cohortKey: cohort:clinicaltrials-nct03641170-gdm-acute
evidenceBucket: clinical-supervised-population-boundaries
whyItMatters: The registry anchors the GDM interval-walking study in a registered protocol and helps avoid treating companion publication details as unregistered or generalized claims.
potentialMurphEndpoints:
- Postprandial glucose
- CGM daytime mean glucose
- Pregnancy exercise feasibility
- Protocol registration lineage
protocolTakeaway: Use as registration context only; cite the companion journal article for outcome findings.
murphTakeaway: Registration details support transparency but do not add independent general-population efficacy evidence.
studyDesign: other
modality: postprandial physical activity / interval walking
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---
This source is included for **clinical-supervised-population-boundaries**.

Source key for extracted claims on this page: `source_artifact:clinicaltrials-nct03641170-2026-04-25`.

## Findings
- The registry identifies an acute physical-activity study in pregnant women with GDM and is linked in accessible article records to the Andersen interval-walking publication.
- It supports protocol provenance for a clinical pregnancy study rather than independent synthesis of efficacy outcomes.
- The companion publication supplies the outcome data; the registry source remains context-only.

## Why it matters
The registry anchors the GDM interval-walking study in a registered protocol and helps avoid treating companion publication details as unregistered or generalized claims.

## Potential experiment signals
- Postprandial glucose
- CGM daytime mean glucose
- Pregnancy exercise feasibility
- Protocol registration lineage

## Protocol takeaway
Use as registration context only; cite the companion journal article for outcome findings.

## Claim use
`context-only`.

## Extraction details

- **Source kind:** trial_registry
- **Study design:** other (Registered acute crossover clinical study)
- **Participant count:** 14 (reported)
- **Population:** Pregnant women with gestational diabetes mellitus.
- **Intervention or exposure:** Postprandial physical activity/interval walking in pregnant women with GDM, as detailed in the companion publication.
- **Comparator or control:** Control/no-exercise period in the registered acute crossover study.
- **Duration or follow-up:** Acute/short crossover study registration; companion publication used four-day intervention and control periods.
- **Endpoints:** Postprandial blood glucose/CGM outcomes.
- **Effect estimates or direction:** No separate registry outcome results extracted; companion publication reports glucose outcomes.
- **Adverse events or safety notes:** No adverse-event results extracted from registry snippets.
- **Population mismatch:** Pregnant women with GDM; context-only clinical boundary.
- **Directness to Walking After Every Meal:** clinical_supervised
- **Artifact candidates / rights:** ClinicalTrials.gov record is public; no copyrighted PDF needs to be committed. `pdfRightsStatus=open_access`.

## Limitations
- Registry/source lineage record.
- Outcome extraction belongs primarily to the companion journal article.
- Pregnancy/GDM population mismatch with general protocol.
- Registry fields may be less detailed than publication.

## Atomic finding links
- `finding:walking-after-every-meal:clinicaltrials-nct03641170-2026-04-25:001`
- `finding:walking-after-every-meal:clinicaltrials-nct03641170-2026-04-25:002`
