---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct06971029-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct06971029-2026-04-25
title: ClinicalTrials.gov registration linked to Peptpure bioactive collagen peptide skin-health trial
summary: ClinicalTrials.gov registry for planned/estimated collagen dose comparison; official record lists no masking and not-yet-recruiting status, with a derived reference to PMID 41588262 that should be verified separately.
status: draft
quality: usable
aliases:
- ClinicalTrials.gov registration linked to Peptpure bioactive collagen peptide skin-health trial
- NCT06971029
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
    registryId: NCT06971029
    url: https://clinicaltrials.gov/study/NCT06971029
  canonicalUrl: https://clinicaltrials.gov/study/NCT06971029
  identityAliases:
  - ClinicalTrials.gov registration linked to Peptpure bioactive collagen peptide skin-health trial
  - NCT06971029
source:
  kind: web_page
  title: ClinicalTrials.gov registration linked to Peptpure bioactive collagen peptide skin-health trial
  authors: Federal University of São Paulo; Rodolfo de Paula Vieira (responsible investigator)
  citation: ClinicalTrials.gov. NCT06971029. Effects of supplementation with low molecular weight hydrolyzed collagen versus Verisol collagen on expression lines, skin quality, and serum Klotho, VEGF, and TGF-beta. First posted 14 May 2025; last updated 14 May 2025.
  year: 2025
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT06971029
researchEvidence:
  designKind: other
  designLabel: Not-yet-recruiting randomized parallel registry with no masking
  populationLabel: Middle-aged sedentary women aged 35-58 years.
  durationLabel: 3 months
  cohortKey: cohort:registry-direct-biomarker-skin-aging
  participantCount: 150
  participantCountKind: approximate
  aggregateRole: primary
evidenceBucket: skin-aging
whyItMatters: It maps Klotho/VEGF/TGF-beta biomarker endpoints and planned 2.5 g vs 10 g collagen dosing, while flagging registry-publication uncertainty.
potentialMurphEndpoints:
- 2.5 g/day
- 10 g/day
- Klotho
- VEGF
- TGF-beta
- expression lines
protocolTakeaway: Treat as registry context with publication-match uncertainty; do not use as efficacy evidence.
murphTakeaway: Mechanistic biomarkers are research-grade; users should not infer systemic anti-aging effects from skin supplement claims without trial data.
studyDesign: rct
modality: oral collagen peptide dose-comparison registry
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

**Findings:** Registry contains dose-comparison details but is not a completed efficacy-results source in this record. Endpoints captured: Klotho; VEGF; TGF-beta; skin hydration; oiliness; flexibility; expression-line number; expression-line depth.

**Why it matters:** It maps Klotho/VEGF/TGF-beta biomarker endpoints and planned 2.5 g vs 10 g collagen dosing, while flagging registry-publication uncertainty.

**Potential experiment signals:** 2.5 g/day, 10 g/day, Klotho, VEGF, TGF-beta, expression lines.

**Protocol takeaway:** Treat as registry context with publication-match uncertainty; do not use as efficacy evidence.

**Claim use:** `context-only`.
