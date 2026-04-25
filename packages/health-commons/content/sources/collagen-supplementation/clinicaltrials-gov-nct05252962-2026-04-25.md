---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct05252962-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct05252962-2026-04-25
title: Bioavailability of Marine-based Peptan Type I Collagen Peptide
summary: ClinicalTrials.gov record for marine collagen peptide bioavailability in healthy subjects.
status: draft
quality: usable
aliases:
- Bioavailability of Marine-based Peptan Type I Collagen Peptide
- NCT05252962
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
    registryId: NCT05252962
    url: https://clinicaltrials.gov/study/NCT05252962
  canonicalUrl: https://clinicaltrials.gov/study/NCT05252962
  identityAliases:
  - Bioavailability of Marine-based Peptan Type I Collagen Peptide
  - NCT05252962
source:
  kind: web_page
  title: Bioavailability of Marine-based Peptan Type I Collagen Peptide
  authors: Rousselot BVBA; BioTeSys GmbH
  citation: ClinicalTrials.gov. Bioavailability of Marine-based Peptan Type I Collagen Peptide. NCT05252962. Captured 2026-04-25.
  year: 2022
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT05252962
researchEvidence:
  designKind: acute_mechanistic
  designLabel: Registered acute bioavailability study
  populationLabel: Healthy volunteers.
  durationLabel: Acute bioavailability sampling; exact sampling window not fully extracted.
  cohortKey: nct05252962-marine-peptan-bioavailability
  participantCount: 14
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: mechanism-bioavailability
whyItMatters: It documents an adjacent mechanism trial for source-specific collagen exposure.
potentialMurphEndpoints:
- plasma peptide metabolites
- amino-acid kinetics
- bioavailability
protocolTakeaway: Registry context only; do not use for efficacy.
murphTakeaway: Marine collagen bioavailability can be tracked, but results were not available in this extraction.
studyDesign: trial_registry_acute_physiology
modality: oral marine-based type I collagen peptide
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

It documents an adjacent mechanism trial for source-specific collagen exposure.

## Potential experiment signals

- plasma peptide metabolites
- amino-acid kinetics
- bioavailability

## Protocol takeaway

Registry context only; do not use for efficacy.

## Safety and adverse events

No safety results extracted.

## Limitations and mismatch

- Registry-only source.
- No efficacy results.
- Participant count taken from indexed registry information and should be verified before synthesis.
- Population mismatch: Healthy acute exposure context.

## Claim use

`context-only`. This source should remain in its assigned evidence bucket and should not be promoted into direct Hydrolyzed Collagen Peptides protocol synthesis unless a later synthesis step explicitly resolves directness and endpoint scope.
