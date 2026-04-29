---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct04499287-2026-04-25
slug: sources/post-meal-walking/clinicaltrials-nct04499287-2026-04-25
title: Mealtime Walking Study to Improve Postprandial Metabolic Response
summary: Completed randomized crossover registry in 10 obese sedentary adults with prediabetic fasting glucose, testing a 15-minute treadmill walk shortly after a bagel-and-juice meal versus seated control and fiber.
status: draft
quality: usable
aliases:
- NCT04499287
- OxPMW
- Mealtime walking registry
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
  title: Mealtime Walking Study to Improve Postprandial Metabolic Response
  authors: Arizona State University; Carol Johnston
  year: 2020
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Mealtime Walking Study to Improve Postprandial Metabolic Response. NCT04499287. First posted 2020-08-05; last updated 2021-07-23.
  url: https://clinicaltrials.gov/study/NCT04499287
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT04499287
    url: https://clinicaltrials.gov/study/NCT04499287
  canonicalUrl: https://clinicaltrials.gov/study/NCT04499287
  identityAliases:
  - NCT04499287
  - OxPMW
  - Mealtime walking registry
researchEvidence:
  designKind: other
  designLabel: Completed randomized crossover meal-test registry record
  participantCount: 10
  participantCountKind: reported
  populationLabel: Obese, sedentary, non-smoking adults aged 35–70 years with fasting capillary glucose 5.6–6.9 mmol/L.
  durationLabel: Three meal tests separated by about 1 week; 4-hour postprandial blood sampling after each test meal.
  aggregateRole: primary
  cohortKey: cohort:clinicaltrials-nct04499287-2026-04-25
  notes:
  - Direct postmeal walk after a meal challenge, but only one meal-test setting rather than walking after every meal.
  - ClinicalTrials.gov has no posted results.
  - Includes fiber as active comparator.
evidenceBucket: free-living-adherence-registries-external-claims
whyItMatters: It records a short, low-burden postmeal walking condition and metabolic endpoints beyond glucose, but remains a registry-only meal challenge.
potentialMurphEndpoints:
- 4-hour postprandial glycemia iAUC
- 4-hour postprandial insulinemia iAUC
- oxidative stress markers
- single-meal adherence/tolerability
protocolTakeaway: Use for meal-test design and endpoint context only; no outcome effect claim should be made from the registry record.
murphTakeaway: Short walks after a high-carbohydrate meal can be tested with glucose and insulin endpoints, but a single test meal does not answer daily adherence.
studyDesign: crossover
modality: 15-minute postmeal treadmill walk at preferred speed
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---
This source is included for **free-living-adherence-registries-external-claims**.

**Findings:** The registry tested a 15-minute treadmill walk beginning after a 5-minute post-meal transition in a bagel+juice crossover meal test; no registry results were posted.

**Why it matters:** It records a short, low-burden postmeal walking condition and metabolic endpoints beyond glucose, but remains a registry-only meal challenge.

**Potential experiment signals:** 4-hour postprandial glycemia iAUC, 4-hour postprandial insulinemia iAUC, oxidative stress markers, single-meal adherence/tolerability.

**Protocol takeaway:** Use for meal-test design and endpoint context only; no outcome effect claim should be made from the registry record.

**Claim use:** `context-only`.

## Extraction details

- **Population:** Obese, sedentary, non-smoking adults aged 35–70 with fasting capillary glucose 5.6–6.9 mmol/L; several GI, supplement, and medication exclusions were listed.

- **Participant count:** 10 actual participants.

- **Intervention/exposure:** After consuming a 640-kcal bagel+juice meal, participants transitioned for 5 minutes and then walked on a motorized treadmill at calculated preferred walking speed for 15 minutes; then remained seated for the rest of the 4-hour visit.

- **Comparator/control:** Seated control after the same test meal; fiber/psyllium active comparator.

- **Duration/follow-up:** Three crossover meal tests, about 1 week apart; 4-hour postprandial sampling window.

- **Endpoints:** Postprandial glycemia iAUC; postprandial insulinemia iAUC; oxidative stress markers including total antioxidant capacity, IL-6, and TBARS.

- **Effect estimates or direction:** No ClinicalTrials.gov result estimate posted.

- **Adverse events/safety notes:** PAR-Q and GI/medication exclusions; no adverse events posted in the registry extract.

- **Limitations:** Registry-only; no posted results; single high-carbohydrate test meal; small actual enrollment; not a repeated every-meal protocol.

- **Population mismatch:** Direct short postmeal walking condition, but in prediabetes/obesity meal-test setting rather than free-living repeated meals.

- **Directness to Walking After Every Meal:** direct_protocol

- **Artifact candidates and rights:** ClinicalTrials.gov registry metadata only; no full-text artifact to vendor.

## Atomic finding links

- `finding:walking-after-every-meal:clinicaltrials-nct04499287-2026-04-25:001`
