---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct07195396-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct07195396-2026-04-25
title: Enriched Human Serum After Oral Collagen Hydrolysate Intake
summary: Registry record for acute collagen metabolite-enriched serum.
status: draft
quality: usable
aliases:
- Enriched Human Serum After Oral Collagen Hydrolysate Intake
- NCT07195396
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
    registryId: NCT07195396
    url: https://clinicaltrials.gov/study/NCT07195396
  canonicalUrl: https://clinicaltrials.gov/study/NCT07195396
  identityAliases:
  - Enriched Human Serum After Oral Collagen Hydrolysate Intake
  - NCT07195396
source:
  kind: web_page
  title: Enriched Human Serum After Oral Collagen Hydrolysate Intake
  authors: ClinicalTrials.gov registry sponsor not verified in extraction
  citation: ClinicalTrials.gov. Enriched Human Serum After Oral Collagen Hydrolysate Intake. NCT07195396. Captured 2026-04-25.
  year: 2026
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT07195396
researchEvidence:
  designKind: acute_mechanistic
  designLabel: Registered acute enriched-human-serum physiology study
  populationLabel: Human serum donors/healthy volunteers.
  durationLabel: Acute single-dose serum collection.
  cohortKey: nct07195396-enriched-serum-collagen-hydrolysate
  participantCount: 3
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: mechanism-bioavailability
whyItMatters: It links to the ex vivo mechanistic strategy used in collagen metabolite studies.
potentialMurphEndpoints:
- serum collagen metabolites
- enriched-serum activity
- bioavailability
protocolTakeaway: Mechanism watchlist only.
murphTakeaway: This is an exposure-model registry, not an outcomes trial.
studyDesign: trial_registry_acute_physiology
modality: single oral collagen hydrolysate dose
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

It links to the ex vivo mechanistic strategy used in collagen metabolite studies.

## Potential experiment signals

- serum collagen metabolites
- enriched-serum activity
- bioavailability

## Protocol takeaway

Mechanism watchlist only.

## Safety and adverse events

No safety results extracted.

## Limitations and mismatch

- Registry-only.
- Participant count from indexed registry information.
- Very small sample.
- No clinical endpoint.
- Population mismatch: Mechanistic serum-donor setting.

## Claim use

`context-only`. This source should remain in its assigned evidence bucket and should not be promoted into direct Hydrolyzed Collagen Peptides protocol synthesis unless a later synthesis step explicitly resolves directness and endpoint scope.
