---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct02128763-2026-04-25
slug: sources/omega-3-supplementation/clinicaltrials-nct02128763-2026-04-25
title: Dry Eye Assessment and Management Study
summary: Registry record for the DREAM dry-eye treatment trial, documenting moderate-to-severe DED eligibility, 2000 mg EPA plus 1000 mg DHA/day intervention, olive-oil placebo, and symptom/sign endpoints over 12 months.
status: draft
quality: usable
aliases:
- Dry Eye Assessment and Management Study
categories:
- omega-3-supplementation
relations:
-
  type: related_protocol
  target: protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation
-
  type: parent_family
  target: experiment_family:omega-3-supplementation
source:
  kind: other
  title: Dry Eye Assessment and Management Study
  authors: ClinicalTrials.gov; University of Pennsylvania
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Dry Eye Assessment and Management Study. NCT02128763. Accessed 2026-04-25.
  url: https://clinicaltrials.gov/study/NCT02128763
researchEvidence:
  designKind: other
  designLabel: Trial registry record
  participantCount: 535
  participantCountKind: reported
  populationLabel: Adults over 18 with moderate-to-severe dry eye disease symptoms for at least 6 months and qualifying OSDI/sign criteria.
  durationLabel: Primary clinical-trial observation over 12 months with extension/discontinuation objectives.
  aggregateRole: context
  cohortKey: dry-eye-treatment-registry
populationMismatch: Treatment registry for established moderate-to-severe DED; not prevention and not general wellness.
evidenceBucket: dry_eye_treatment_prevention
whyItMatters: This registry separates the DREAM treatment population from VITAL prevention and general adult supplementation.
potentialMurphEndpoints:
- OSDI
- BODI pain interference
- Schirmer test
- TBUT
- corneal/conjunctival staining
- artificial-tear use
protocolTakeaway: Use as registry/design context only.
murphTakeaway: High-dose dry-eye treatment protocols require clinical eligibility and safety screening.
studyDesign: trial_registry
modality: trial registry
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: unknown
---
This source is included for **dry_eye_treatment_prevention**.

**Findings:** Population: Adults over 18 with moderate-to-severe dry eye disease symptoms for at least 6 months and qualifying OSDI/sign criteria. Intervention/exposure: Total 2000 mg EPA plus 1000 mg DHA per day taken in five gelcaps. Comparator/control: Olive oil placebo, five gelcaps per day. Duration/follow-up: Primary clinical-trial observation over 12 months with extension/discontinuation objectives. Endpoints: mean change in OSDI at 6 and 12 months, OSDI response, BODI pain interference, SF-36, conjunctival staining, Schirmer test, TBUT, corneal staining, visual acuity, artificial-tear use. Effect/direction: Not efficacy evidence; registry documents design, eligibility, intervention, comparator, and endpoints. Safety/adverse events: Exclusions included allergy to ingredients, pregnancy/lactation, ocular infection/inflammation, liver disease, atrial fibrillation, hemophilia or bleeding tendencies, anticoagulation therapy, and EPA/DHA supplement use above 1200 mg/day.

**Why it matters:** This registry separates the DREAM treatment population from VITAL prevention and general adult supplementation.

**Potential experiment signals:** OSDI, BODI pain interference, Schirmer test, TBUT, corneal/conjunctival staining, artificial-tear use.

**Protocol takeaway:** Use as registry/design context only.

**Limitations and population mismatch:** Registry/design source only; use DREAM result publications for efficacy outcomes.; Treatment population differs from prevention and wellness contexts. Population mismatch: Treatment registry for established moderate-to-severe DED; not prevention and not general wellness.

**Claim use:** `context-only`.
