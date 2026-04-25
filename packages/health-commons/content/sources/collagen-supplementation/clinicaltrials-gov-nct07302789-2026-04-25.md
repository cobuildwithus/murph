---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct07302789-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct07302789-2026-04-25
title: Clinical Effects of Two Oral Bioactive Collagen Peptides On Age-Associated Skin Beauty and Aging Hallmarks
summary: Completed registry comparing two collagen peptide products without a no-collagen placebo; no posted results in the registry record.
status: draft
quality: usable
aliases:
- Clinical Effects of Two Oral Bioactive Collagen Peptides On Age-Associated Skin Beauty and Aging Hallmarks
- NCT07302789
categories:
- collagen-supplementation
- skin-aging
- direct_protocol
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
    registryId: NCT07302789
    url: https://clinicaltrials.gov/study/NCT07302789
  canonicalUrl: https://clinicaltrials.gov/study/NCT07302789
  identityAliases:
  - Clinical Effects of Two Oral Bioactive Collagen Peptides On Age-Associated Skin Beauty and Aging Hallmarks
  - NCT07302789
source:
  kind: web_page
  title: Clinical Effects of Two Oral Bioactive Collagen Peptides On Age-Associated Skin Beauty and Aging Hallmarks
  authors: Bionos Biotech S.L.
  citation: ClinicalTrials.gov. NCT07302789. Clinical Effects of Two Oral Bioactive Collagen Peptides On Skin Properties and Aging Hallmarks. First posted 24 Dec 2025; last updated 17 Feb 2026.
  year: 2025
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT07302789
researchEvidence:
  designKind: other
  designLabel: Completed randomized quadruple-blind active-comparator collagen-vs-collagen registry
  populationLabel: Healthy women aged 35-65 years with visible crow's-feet wrinkles.
  durationLabel: 8 weeks
  cohortKey: cohort:registry-active-comparator-skin-aging
  participantCount: 67
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: skin-aging
whyItMatters: It broadens registry recall and flags active-comparator designs that cannot answer collagen-vs-none questions.
potentialMurphEndpoints:
- 2.5 g/day
- active comparator
- wrinkle 3D imaging
- Cutometer
- Corneometer
- TEWL
- safety monitoring
protocolTakeaway: Use for context and active-comparator boundary only; do not use as direct placebo evidence.
murphTakeaway: When comparing collagen brands, use the same dose and consistent routines; results may not answer whether collagen itself works versus no collagen.
studyDesign: rct
modality: oral hydrolyzed bovine collagen peptides
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: skin-aging
  directness: direct_protocol
  claimUse: context-only
  priority: medium
  batchId: batch-005
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **skin-aging**.

**Findings:** Collagen-vs-collagen active-comparator registry is useful for product comparison boundaries, not placebo efficacy. Endpoints captured: facial wrinkle area; wrinkle length; wrinkle depth; wrinkle volume; skin firmness; skin elasticity; skin fatigue; skin hydration; TEWL; self-assessment; adverse events.

**Why it matters:** It broadens registry recall and flags active-comparator designs that cannot answer collagen-vs-none questions.

**Potential experiment signals:** 2.5 g/day, active comparator, wrinkle 3D imaging, Cutometer, Corneometer, TEWL, safety monitoring.

**Protocol takeaway:** Use for context and active-comparator boundary only; do not use as direct placebo evidence.

**Claim use:** `context-only`.
