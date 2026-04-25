---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct05722158-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct05722158-2026-04-25
title: Bioavailability of Different Collagen-based Treatments After Ingestion of Collagen Peptides
summary: Registry record for collagen-based treatment bioavailability and postprandial absorption.
status: draft
quality: usable
aliases:
- Bioavailability of Different Collagen-based Treatments After Ingestion of Collagen Peptides
- NCT05722158
categories:
- collagen-supplementation
- mechanism-bioavailability
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
    registryId: NCT05722158
    url: https://clinicaltrials.gov/study/NCT05722158
  canonicalUrl: https://clinicaltrials.gov/study/NCT05722158
  identityAliases:
  - Bioavailability of Different Collagen-based Treatments After Ingestion of Collagen Peptides
  - NCT05722158
source:
  kind: web_page
  title: Bioavailability of Different Collagen-based Treatments After Ingestion of Collagen Peptides
  authors: ClinicalTrials.gov registry sponsor not verified in extraction
  citation: ClinicalTrials.gov. Bioavailability of Different Collagen-based Treatments After Ingestion of Collagen Peptides. NCT05722158. Captured 2026-04-25.
  year: 2023
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT05722158
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Registered randomized bioavailability trial
  populationLabel: Healthy volunteers.
  durationLabel: Acute postprandial absorption sampling.
  cohortKey: nct05722158-collagen-treatment-bioavailability
  aggregateRole: primary
evidenceBucket: mechanism-bioavailability
whyItMatters: It reinforces that bioavailability is an active research axis separate from protocol efficacy.
potentialMurphEndpoints:
- postprandial peptide metabolites
- LC-MS collagen-derived peptides
- bioavailability
protocolTakeaway: Keep as mechanism registry context only.
murphTakeaway: Useful watchlist record, not evidence of benefit.
studyDesign: trial_registry_randomized_bioavailability_study
modality: oral collagen-based treatments
claimUse: context-only
murphV1Priority: Low
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: mechanism-bioavailability
  directness: same_mechanism
  claimUse: context-only
  priority: low
  batchId: batch-010
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **mechanism-bioavailability**.

## Findings

No results extracted.

## Why it matters

It reinforces that bioavailability is an active research axis separate from protocol efficacy.

## Potential experiment signals

- postprandial peptide metabolites
- LC-MS collagen-derived peptides
- bioavailability

## Protocol takeaway

Keep as mechanism registry context only.

## Safety and adverse events

No safety results extracted.

## Limitations and mismatch

- Registry-only.
- Participant count not verified.
- Healthy volunteer and acute absorption context.
- No outcome efficacy data.
- Population mismatch: Healthy acute PK context rather than protocol outcome population.

## Claim use

`context-only`. This source should remain in its assigned evidence bucket and should not be promoted into direct Hydrolyzed Collagen Peptides protocol synthesis unless a later synthesis step explicitly resolves directness and endpoint scope.
