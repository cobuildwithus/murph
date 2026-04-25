---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct07456449-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct07456449-2026-04-25
title: Collagen Peptides and Cellular Aging
summary: ClinicalTrials.gov registry for collagen peptides and cellular-aging endpoints.
status: draft
quality: usable
aliases:
- Collagen Peptides and Cellular Aging
- NCT07456449
categories:
- collagen-supplementation
- background-general
- same_mechanism
- context-only
relations:
-
  type: related_protocol
  target: protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides
-
  type: parent_family
  target: experiment_family:collagen-supplementation
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT07456449
    url: https://clinicaltrials.gov/study/NCT07456449
  canonicalUrl: https://clinicaltrials.gov/study/NCT07456449
  identityAliases:
  - Collagen Peptides and Cellular Aging
  - NCT07456449
source:
  kind: web_page
  title: Collagen Peptides and Cellular Aging
  authors: University of Vienna; Collagen Research Institute
  citation: ClinicalTrials.gov. Collagen Peptides and Cellular Aging. NCT07456449. Captured 2026-04-25.
  year: 2026
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT07456449
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Registered randomized controlled trial; unpublished at extraction
  populationLabel: Adults aged 50-70 years with overweight and low-to-moderate physical activity, without major chronic disease.
  durationLabel: 24 weeks planned.
  cohortKey: nct07456449-cellular-aging
  participantCount: 125
  participantCountKind: approximate
  aggregateRole: primary
evidenceBucket: background-general
whyItMatters: It expands the map of emerging collagen-peptide endpoints while keeping unpublished evidence out of efficacy claims.
potentialMurphEndpoints:
- telomere length
- telomerase activity
- DNA damage
- inflammatory markers
- handgrip/functional markers
protocolTakeaway: Track as future context; do not cite for current protocol benefit.
murphTakeaway: Interesting aging-biomarker hypothesis, but no results yet.
studyDesign: trial_registry_randomized_controlled_trial
modality: oral collagen peptides
claimUse: context-only
murphV1Priority: Low
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: background-general
  directness: same_mechanism
  claimUse: context-only
  priority: low
  batchId: batch-010
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **background-general**.

## Findings

No efficacy results available in the registry extraction.

## Why it matters

It expands the map of emerging collagen-peptide endpoints while keeping unpublished evidence out of efficacy claims.

## Potential experiment signals

- telomere length
- telomerase activity
- DNA damage
- inflammatory markers
- handgrip/functional markers

## Protocol takeaway

Track as future context; do not cite for current protocol benefit.

## Safety and adverse events

No adverse-event results available.

## Limitations and mismatch

- Unpublished registry record.
- Biomarker-heavy aging endpoint set.
- Participant count is planned enrollment.
- Dose and full product details not verified in extracted text.
- Population mismatch: Aging-biomarker population and endpoints are outside core skin/joint/tendon protocol outcomes.

## Claim use

`context-only`. This source should remain in its assigned evidence bucket and should not be promoted into direct Hydrolyzed Collagen Peptides protocol synthesis unless a later synthesis step explicitly resolves directness and endpoint scope.
