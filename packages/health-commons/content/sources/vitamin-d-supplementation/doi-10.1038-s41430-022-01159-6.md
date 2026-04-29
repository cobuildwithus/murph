---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1038-s41430-022-01159-6
slug: sources/vitamin-d-supplementation/doi-10.1038-s41430-022-01159-6
title: The role of baseline serum 25-hydroxyvitamin D concentration for determining vitamin D3 supplement dose and treatment outcomes for individuals with vitamin D deficiency
summary: In the Botswana dataset, body weight was inversely associated with achieved 25(OH)D response; standard and experimental dose arms did not show a clearly significant adjusted difference.
status: draft
quality: usable
aliases:
  - The role of baseline serum 25-hydroxyvitamin D concentration for determining vitamin D3 supplement dose and treatment outcomes for individuals with vitamin D deficiency
  - PMC9630113
  - 10.1038/s41430-022-01159-6
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
    pmcid: PMC9630113
    doi: 10.1038/s41430-022-01159-6
    url: https://www.nature.com/articles/s41430-022-01159-6
  canonicalUrl: https://www.nature.com/articles/s41430-022-01159-6
source:
  kind: journal_article
  title: The role of baseline serum 25-hydroxyvitamin D concentration for determining vitamin D3 supplement dose and treatment outcomes for individuals with vitamin D deficiency
  doi: 10.1038/s41430-022-01159-6
  url: https://www.nature.com/articles/s41430-022-01159-6
  citation: The role of baseline serum 25-hydroxyvitamin D concentration for determining vitamin D3 supplement dose and treatment outcomes for individuals with vitamin D deficiency; PMCID:PMC9630113; DOI:10.1038/s41430-022-01159-6; https://www.nature.com/articles/s41430-022-01159-6
researchEvidence:
  designKind: other
  designLabel: other
  populationLabel: Vitamin-D-deficient children/adults in Botswana and older Finnish adults with prediabetes represented in two reanalyzed datasets
  durationLabel: 12 weeks
  aggregateRole: context
  cohortKey: cohort:doi-10.1038-s41430-022-01159-6
  notes:
    - Evidence bucket: same-mechanism-dose-response-context
    - Directness: same_mechanism; claim use: context-only; priority: high
    - Candidate row: candidate:baseline-status:014; shard: baseline-status. Candidate rationale: Focused specifically on baseline 25(OH)D as a determinant of vitamin D3 dose and achieved treatment outcome.
sourceFindings:

  -
    findingId: finding:daily-vitamin-d3-supplementation:doi-10.1038-s41430-022-01159-6:001
    sourceKey: source_artifact:doi-10.1038-s41430-022-01159-6
    findingKind: context
    population: Vitamin-D-deficient children/adults in Botswana and older Finnish adults with prediabetes represented in two reanalyzed datasets
    exposure: Daily vitamin D3 at 4000 vs 7000 IU/day in one dataset and 1600 vs 3200 IU/day in another
    outcome: Baseline response and body weight — In the Botswana dataset, body weight was inversely associated with achieved 25(OH)D response; standard and experimental dose arms did not show a clearly significant adjusted difference.
    summary: In the Botswana dataset, body weight was inversely associated with achieved 25(OH)D response; standard and experimental dose arms did not show a clearly significant adjusted difference.
    evidenceUse:
      - mechanism
  -
    findingId: finding:daily-vitamin-d3-supplementation:doi-10.1038-s41430-022-01159-6:002
    sourceKey: source_artifact:doi-10.1038-s41430-022-01159-6
    findingKind: intervention_result
    population: Vitamin-D-deficient children/adults in Botswana and older Finnish adults with prediabetes represented in two reanalyzed datasets
    exposure: Daily vitamin D3 at 4000 vs 7000 IU/day in one dataset and 1600 vs 3200 IU/day in another
    outcome: Higher versus lower D3 in older Finnish adults — In the Finnish subset, 3200 IU/day raised 25(OH)D more than 1600 IU/day, with baseline 20 ng/mL predicted to have an additional net gain of about 5.44 ng/mL for the higher dose.
    summary: In the Finnish subset, 3200 IU/day raised 25(OH)D more than 1600 IU/day, with baseline 20 ng/mL predicted to have an additional net gain of about 5.44 ng/mL for the higher dose.
    evidenceUse:
      - mechanism
---

This source page stores extracted Health Commons evidence for **The role of baseline serum 25-hydroxyvitamin D concentration for determining vitamin D3 supplement dose and treatment outcomes for individuals with vitamin D deficiency**.

## Evidence role

- Evidence bucket: `same-mechanism-dose-response-context`
- Directness for Daily Vitamin D3 Supplementation: `same_mechanism`
- Protocol claim use: `context-only`
- Source key: `source_artifact:doi-10.1038-s41430-022-01159-6`

## Extracted findings

- `finding:daily-vitamin-d3-supplementation:doi-10.1038-s41430-022-01159-6:001` (context): In the Botswana dataset, body weight was inversely associated with achieved 25(OH)D response; standard and experimental dose arms did not show a clearly significant adjusted difference.
- `finding:daily-vitamin-d3-supplementation:doi-10.1038-s41430-022-01159-6:002` (intervention_result): In the Finnish subset, 3200 IU/day raised 25(OH)D more than 1600 IU/day, with baseline 20 ng/mL predicted to have an additional net gain of about 5.44 ng/mL for the higher dose.

## Protocol-use note

Use this source according to the extracted directness and claim-use fields above. Do not convert adjacent variants, safety-only sources, or context-only findings into direct efficacy claims for the Murph daily D3 protocol.
