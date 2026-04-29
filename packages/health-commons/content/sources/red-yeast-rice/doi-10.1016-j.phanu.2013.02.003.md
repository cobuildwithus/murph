---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1016-j.phanu.2013.02.003"
slug: "sources/red-yeast-rice/doi-10.1016-j.phanu.2013.02.003"
title: "Nutraceutical combination (red yeast rice, berberine and policosanols) improves aortic stiffness in low-moderate risk hypercholesterolemic patients"
summary: "Combination treatment reportedly reduced LDL-C by about 20% and improved aortic pulse wave velocity from 9.1 ± 2.0 to 8.3 ± 1.7 m/s; the no-active-treatment group did not show the same change."
status: "draft"
quality: "usable"
aliases:
  - "doi-10.1016-j.phanu.2013.02.003"
  - "Nutraceutical combination (red yeast rice, berberine and policosanols) improves aortic stiffness in low-moderate risk hypercholesterolemic patients"
categories:
  - "red-yeast-rice"
  - "adjacent-combination-evidence"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "journal_article"
  title: "Nutraceutical combination (red yeast rice, berberine and policosanols) improves aortic stiffness in low-moderate risk hypercholesterolemic patients"
  authors: "Matteo Pirro; Graziana Lupattelli; Rosaria Del Giorno; Giuseppe Schillaci; Sokol Berisha; Massimo R. Mannarino; Francesco Bagaglia; Francesco Melis; Elmo Mannarino"
  journal: "PharmaNutrition"
  citation: "Matteo Pirro; Graziana Lupattelli; Rosaria Del Giorno; Giuseppe Schillaci; Sokol Berisha; Massimo R. Mannarino; Francesco Bagaglia; Francesco Melis; Elmo Mannarino. 2013. Nutraceutical combination (red yeast rice, berberine and policosanols) improves aortic stiffness in low-moderate risk hypercholesterolemic patients. PharmaNutrition. doi:10.1016/j.phanu.2013.02.003"
  year: 2013
  doi: "10.1016/j.phanu.2013.02.003"
  url: "https://doi.org/10.1016/j.phanu.2013.02.003"
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.1016/j.phanu.2013.02.003"
    titleHash: "16a99aeb08dd26a23584b3eab78cb6ab19b70d18d0fef4c170fd084050a0646c"
    url: "https://doi.org/10.1016/j.phanu.2013.02.003"
  canonicalUrl: "https://doi.org/10.1016/j.phanu.2013.02.003"
researchEvidence:
  designKind: "controlled_trial"
  designLabel: "clinical study of nutraceutical combination versus no active treatment"
  populationLabel: "Low-to-moderate cardiovascular-risk hypercholesterolemic patients."
  durationLabel: "Duration not extracted from accessible metadata."
  aggregateRole: "primary"
  cohortKey: "cohort_doi_10_1016_j_phanu_2013_02_003"
  notes:
    - "Comparator/control: No active nutraceutical treatment."
    - "Population mismatch: Combination-product vascular-function context rather than plain RYR protocol evidence."
    - "Limitations: RYR, berberine, and policosanols are not separable; no plain RYR-only arm; accessible extraction did not verify all methods details."
  participantCount: 70
  participantCountKind: "reported"
evidenceBucket: "Adjacent combinations and special-population evidence"
whyItMatters: "Backfills arterial-stiffness outcome cluster but should not support RYR-alone claims."
potentialMurphEndpoints:
  - "ldl-c"
  - "pulse-wave-velocity"
  - "adverse-events"
protocolTakeaway: "Do not use as a direct plain red-yeast-rice efficacy claim unless a separable RYR-only arm is verified; use for boundary/context only."
murphTakeaway: "Combination treatment reportedly reduced LDL-C by about 20% and improved aortic pulse wave velocity from 9.1 ± 2.0 to 8.3 ± 1.7 m/s; the no-active-treatment group did not show the same change. For Murph, the usable takeaway is the boundary: Combination-product vascular-function context rather than plain RYR protocol evidence."
studyDesign: "clinical study of nutraceutical combination versus no active treatment"
modality: "oral nutraceutical combination"
claimUse: "context-only"
sourceFindings:

  -
    findingId: "finding:doi-10.1016-j.phanu.2013.02.003-adjacent"
    sourceKey: "source_artifact:doi-10.1016-j.phanu.2013.02.003"
    findingKind: "intervention_result"
    population: "Low-to-moderate cardiovascular-risk hypercholesterolemic patients."
    exposure: "Nutraceutical combination containing red yeast rice 200 mg, berberine 500 mg, and policosanols 10 mg."
    outcome: "LDL-C and aortic pulse wave velocity/aortic stiffness."
    summary: "Combination treatment reportedly reduced LDL-C by about 20% and improved aortic pulse wave velocity from 9.1 ± 2.0 to 8.3 ± 1.7 m/s; the no-active-treatment group did not show the same change. Boundary: RYR, berberine, and policosanols are not separable; no plain RYR-only arm; accessible extraction did not verify all methods details."
    evidenceUse:
      - "adjacent_variant"
      - "efficacy"
      - "measurement"
murphV1Priority: "Medium"
pdfRightsStatus: "permission_required"
---
This source is included for **Adjacent combinations and special-population evidence**.

**Findings:** Combination treatment reportedly reduced LDL-C by about 20% and improved aortic pulse wave velocity from 9.1 ± 2.0 to 8.3 ± 1.7 m/s; the no-active-treatment group did not show the same change.

**Why it matters:** Backfills arterial-stiffness outcome cluster but should not support RYR-alone claims.

**Potential experiment signals:** ldl-c, pulse-wave-velocity, adverse-events.

**Protocol takeaway:** Do not promote this source to a direct plain red yeast rice claim without a separable RYR-only arm. Preserve the boundary: Combination-product vascular-function context rather than plain RYR protocol evidence.

**Claim use:** `context-only`.

**Comparator/control:** No active nutraceutical treatment.

**Duration/follow-up:** Duration not extracted from accessible metadata.

**Safety/adverse events:** Adverse-event details were not extracted from accessible metadata.

**Limitations:** RYR, berberine, and policosanols are not separable; no plain RYR-only arm; accessible extraction did not verify all methods details.
