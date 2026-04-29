---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct03855774-2019-02-28
slug: sources/caffeine-timing/clinicaltrials-nct03855774-2019-02-28
title: Polymorphisms, Caffeine and Sleep Disorders
summary: This completed registry record for SOCAF enrolled 1,100 active workers aged 18-60 for one-time saliva genotyping and questionnaire screening of caffeine-related polymorphisms and sleep-disorder risk; no registry outcome results were extracted.
status: draft
quality: usable
aliases:
- Polymorphisms, Caffeine and Sleep Disorders
- source_artifact:clinicaltrials-nct03855774-2019-02-28
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: other
  title: Polymorphisms, Caffeine and Sleep Disorders
  authors: Institut de Recherche Biomedicale des Armees
  year: 2019
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Polymorphisms, Caffeine and Sleep Disorders (SOCAF). NCT03855774. First posted February 27, 2019; last update posted February 28, 2019.
  url: https://clinicaltrials.gov/study/NCT03855774
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: NCT03855774
    url: https://clinicaltrials.gov/study/NCT03855774
  canonicalUrl: https://clinicaltrials.gov/study/NCT03855774
researchEvidence:
  designKind: other
  designLabel: Completed one-arm screening registry record
  participantCount: 1100
  populationLabel: Active workers aged 18-60 years recruited during occupational health visits in France.
  durationLabel: One saliva sample and computerized questionnaire at screening; study completion listed as December 1, 2018.
  aggregateRole: context
  cohortKey: nct03855774-socaf-registry
  notes:
  - 'Intervention or exposure: Genotyping of 22 polymorphisms associated with caffeine pharmacokinetics/pharmacodynamics and sleep-disorder screening.'
  - 'Comparator or control: No randomized comparator; single-group assignment/open-label screening.'
  - 'Endpoints: Primary outcome was sleep-disorder frequency by genetic polymorphism; secondary outcome included total sleep time as a function of polymorphisms.'
  - 'Effect or direction: Registry record did not provide outcome results in the extracted pages.'
  - 'Safety notes: Studies a US FDA-regulated drug product: no; IPD sharing plan: no.'
  - 'Population mismatch: Screening registry in workers, not a consumer 14-day curfew intervention.'
  - 'Limitation: Registry-only source; do not infer efficacy or published results from registration alone.'
evidenceBucket: pharmacology_individual_differences
whyItMatters: It shows an external registered study explicitly connecting caffeine-related polymorphisms and sleep-disorder risk, but it remains context-only until results are available or linked to a publication.
potentialMurphEndpoints:
- total sleep time
- sleep complaints
- caffeine dose log
- genotype/sensitivity flag
protocolTakeaway: Use as registry context for the genotype/caffeine/sleep research landscape; do not cite as outcome evidence.
murphTakeaway: Genetic sensitivity has enough research interest to appear in registered sleep-disorder screening, but user-facing protocol claims need published results.
studyDesign: other
modality: trial-registry-genotype-sleep-screening
claimUse: context-only
sourceFindings:
- findingId: finding:nct03855774-registry-genotype-caffeine-sleep-screening
  sourceKey: source_artifact:clinicaltrials-nct03855774-2019-02-28
  extractedFromArtifactId: art_clinicaltrials-nct03855774-2019-02-28_html
  findingKind: context
  population: 1,100 active workers aged 18-60 years in France per registry enrollment.
  exposure: One-time saliva genotyping of caffeine pharmacokinetic/pharmacodynamic polymorphisms and computerized sleep/caffeine questionnaire.
  outcome: Sleep-disorder frequency by genetic polymorphism and total sleep time by polymorphism
  summary: The completed SOCAF registry record describes a one-arm screening study of caffeine-related polymorphisms and sleep disorders in active workers, but no registry outcome results were extracted.
  evidenceUse:
  - context
  - measurement
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **pharmacology_individual_differences**.

**Findings:** The completed SOCAF registry record describes a one-arm screening study of caffeine-related polymorphisms and sleep disorders in active workers, but no registry outcome results were extracted.

**Why it matters:** It shows an external registered study explicitly connecting caffeine-related polymorphisms and sleep-disorder risk, but it remains context-only until results are available or linked to a publication.

**Potential experiment signals:** total sleep time, sleep complaints, caffeine dose log, genotype/sensitivity flag.

**Protocol takeaway:** Use as registry context for the genotype/caffeine/sleep research landscape; do not cite as outcome evidence.

**Claim use:** `context-only`.
