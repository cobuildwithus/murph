---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct01930539-uvb-intestinal-rehabilitation-2026-04-25
slug: sources/vitamin-d-supplementation/clinicaltrials-nct01930539-uvb-intestinal-rehabilitation-2026-04-25
title: Treatment of Vitamin D Deficiency in Intestinal Rehabilitation Clinic Patients Using Ultraviolet B Light
summary: UVB treatment in intestinal rehabilitation is adjacent, supervised, and population-mismatched; this registry record does not provide an efficacy result for oral D3.
status: draft
quality: usable
aliases:
  - Treatment of Vitamin D Deficiency in Intestinal Rehabilitation Clinic Patients Using Ultraviolet B Light
categories:
  - vitamin-d-supplementation
relations:

  -
    type: related_protocol
    target: protocol_variant:vitamin-d-supplementation/daily-vitamin-d3-supplementation
  -
    type: parent_family
    target: experiment_family:vitamin-d-supplementation
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    url: https://clinicaltrials.gov/study/NCT01930539
  canonicalUrl: https://clinicaltrials.gov/study/NCT01930539
source:
  kind: web_page
  title: Treatment of Vitamin D Deficiency in Intestinal Rehabilitation Clinic Patients Using Ultraviolet B Light
  url: https://clinicaltrials.gov/study/NCT01930539
  citation: Treatment of Vitamin D Deficiency in Intestinal Rehabilitation Clinic Patients Using Ultraviolet B Light; https://clinicaltrials.gov/study/NCT01930539
researchEvidence:
  designKind: other
  designLabel: other
  populationLabel: Intestinal rehabilitation clinic patients with vitamin D deficiency
  durationLabel: not extracted
  aggregateRole: context
  cohortKey: cohort:clinicaltrials-nct01930539-uvb-intestinal-rehabilitation-2026-04-25
  notes:
    - Evidence bucket: uvb-sunlight-variant-context
    - Directness: adjacent_variant; claim use: context-only; priority: medium
    - Candidate row: candidate:adjacent-variants:056; shard: adjacent-variants. Adjacent route/vehicle variant; use only to separate daily oral supplement evidence from UVB/sunlight or fortified-food evidence. Candidate rationale: Registry source for UVB treatment in malabsorption/intestinal rehabilitation; useful as boundary and population-mismatch evidence.
sourceFindings:

  -
    findingId: finding:daily-vitamin-d3-supplementation:clinicaltrials-nct01930539-uvb-intestinal-rehabilitation-2026-04-25:001
    sourceKey: source_artifact:clinicaltrials-nct01930539-uvb-intestinal-rehabilitation-2026-04-25
    findingKind: other
    population: Intestinal rehabilitation clinic patients with vitamin D deficiency
    exposure: Portable ultraviolet B light administered in multiple body areas once weekly as described by the registry search record
    outcome: biomarker:serum-25-oh-vitamin-d, exposure:uvb, safety:uvb-exposure — The registry record describes a portable UVB-light intervention for vitamin D deficiency in intestinal rehabilitation clinic patients, with no extracted effect estimate, enrollment, or adverse-event result.
    summary: UVB treatment in intestinal rehabilitation is adjacent, supervised, and population-mismatched; this registry record does not provide an efficacy result for oral D3.
    evidenceUse:
      - adjacent_variant
---

This source page stores extracted Health Commons evidence for **Treatment of Vitamin D Deficiency in Intestinal Rehabilitation Clinic Patients Using Ultraviolet B Light**.

## Evidence role

- Evidence bucket: `uvb-sunlight-variant-context`
- Directness for Daily Vitamin D3 Supplementation: `adjacent_variant`
- Protocol claim use: `context-only`
- Source key: `source_artifact:clinicaltrials-nct01930539-uvb-intestinal-rehabilitation-2026-04-25`

## Extracted findings

- `finding:daily-vitamin-d3-supplementation:clinicaltrials-nct01930539-uvb-intestinal-rehabilitation-2026-04-25:001` (other): UVB treatment in intestinal rehabilitation is adjacent, supervised, and population-mismatched; this registry record does not provide an efficacy result for oral D3.

## Protocol-use note

Use this source according to the extracted directness and claim-use fields above. Do not convert adjacent variants, safety-only sources, or context-only findings into direct efficacy claims for the Murph daily D3 protocol.
