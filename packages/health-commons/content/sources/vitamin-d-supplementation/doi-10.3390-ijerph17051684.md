---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.3390-ijerph17051684
slug: sources/vitamin-d-supplementation/doi-10.3390-ijerph17051684
title: The Effect of Ultraviolet B Irradiation Compared with Oral Vitamin D Supplementation on the Well-being of Nursing Home Residents with Dementia: A Randomized Controlled Trial
summary: In frail nursing-home residents with dementia, supervised UVB did not improve primary well-being outcomes and was inferior to weekly oral cholecalciferol for 25(OH)D at 6 months.
status: draft
quality: usable
aliases:
  - The Effect of Ultraviolet B Irradiation Compared with Oral Vitamin D Supplementation on the Well-being of Nursing Home Residents with Dementia: A Randomized Controlled Trial
  - PMC7084916
  - 10.3390/ijerph17051684
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
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    pmcid: PMC7084916
    doi: 10.3390/ijerph17051684
    url: https://doi.org/10.3390/ijerph17051684
  canonicalUrl: https://doi.org/10.3390/ijerph17051684
source:
  kind: journal_article
  title: The Effect of Ultraviolet B Irradiation Compared with Oral Vitamin D Supplementation on the Well-being of Nursing Home Residents with Dementia: A Randomized Controlled Trial
  doi: 10.3390/ijerph17051684
  url: https://doi.org/10.3390/ijerph17051684
  citation: The Effect of Ultraviolet B Irradiation Compared with Oral Vitamin D Supplementation on the Well-being of Nursing Home Residents with Dementia: A Randomized Controlled Trial; PMCID:PMC7084916; DOI:10.3390/ijerph17051684; https://doi.org/10.3390/ijerph17051684
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: rct
  populationLabel: Nursing home residents over age 70 with dementia
  durationLabel: 6 months
  aggregateRole: context
  cohortKey: cohort:doi-10.3390-ijerph17051684
  notes:
    - Evidence bucket: uvb-sunlight-variant-context
    - Directness: adjacent_variant; claim use: context-only; priority: medium
    - Candidate row: candidate:adjacent-variants:041; shard: adjacent-variants. Adjacent route/vehicle variant; use only to separate daily oral supplement evidence from UVB/sunlight or fortified-food evidence. Candidate rationale: Frail-population RCT comparing UVB with oral supplementation; useful but population mismatch for general daily D3 protocol.
sourceFindings:

  -
    findingId: finding:daily-vitamin-d3-supplementation:doi-10.3390-ijerph17051684:001
    sourceKey: source_artifact:doi-10.3390-ijerph17051684
    findingKind: other
    population: Nursing home residents over age 70 with dementia
    exposure: Half-body UVB irradiation twice weekly at 1 standard erythema dose
    outcome: outcome:well-being, biomarker:serum-25-oh-vitamin-d, symptom:agitation, symptom:depressive-symptoms, safety:uvb-exposure — No significant between-group differences were found for agitation (p=0.431) or depressive symptoms (p=0.982). At 6 months, the UVB group had lower serum 25(OH)D3 than the weekly oral vitamin D group (estimated mean difference -21.9 nmol/L; 95% CI -32.6 to -11.2; p=0.003). A secondary restless/tense signal was reported for UVB but required confirmation.
    summary: In frail nursing-home residents with dementia, supervised UVB did not improve primary well-being outcomes and was inferior to weekly oral cholecalciferol for 25(OH)D at 6 months.
    evidenceUse:
      - adjacent_variant
---

This source page stores extracted Health Commons evidence for **The Effect of Ultraviolet B Irradiation Compared with Oral Vitamin D Supplementation on the Well-being of Nursing Home Residents with Dementia: A Randomized Controlled Trial**.

## Evidence role

- Evidence bucket: `uvb-sunlight-variant-context`
- Directness for Daily Vitamin D3 Supplementation: `adjacent_variant`
- Protocol claim use: `context-only`
- Source key: `source_artifact:doi-10.3390-ijerph17051684`

## Extracted findings

- `finding:daily-vitamin-d3-supplementation:doi-10.3390-ijerph17051684:001` (other): In frail nursing-home residents with dementia, supervised UVB did not improve primary well-being outcomes and was inferior to weekly oral cholecalciferol for 25(OH)D at 6 months.

## Protocol-use note

Use this source according to the extracted directness and claim-use fields above. Do not convert adjacent variants, safety-only sources, or context-only findings into direct efficacy claims for the Murph daily D3 protocol.
