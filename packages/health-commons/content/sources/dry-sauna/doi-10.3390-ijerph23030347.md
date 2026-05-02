---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.3390-ijerph23030347"
slug: "sources/dry-sauna/doi-10.3390-ijerph23030347"
title: "Effects of Bathtub Bathing and Sauna Practices on Cardiovascular and Systemic Health: A Narrative Review"
summary: "Narrative review frames sauna evidence as mainly observational with safety considerations."
status: "draft"
quality: "usable"
aliases:
  - "DOI 10.3390/ijerph23030347"
categories:
  - "dry-sauna"
  - "reviews_meta_guidelines"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week"
  -
    type: "parent_family"
    target: "experiment_family:dry-sauna"
source:
  kind: "review"
  title: "Effects of Bathtub Bathing and Sauna Practices on Cardiovascular and Systemic Health: A Narrative Review"
  authors: "Masayo Nagai, Akiko Tanaka"
  journal: "International Journal of Environmental Research and Public Health"
  doi: "10.3390/ijerph23030347"
  url: "https://doi.org/10.3390/ijerph23030347"
  citation: "Effects of Bathtub Bathing and Sauna Practices on Cardiovascular and Systemic Health: A Narrative Review. https://doi.org/10.3390/ijerph23030347"
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.3390/ijerph23030347"
    titleHash: "a2d747e984faf021903c637d342ad052912bf78769859dbb5c8733a004223c92"
    url: "https://doi.org/10.3390/ijerph23030347"
  canonicalUrl: "https://doi.org/10.3390/ijerph23030347"
researchEvidence:
  designKind: "narrative_review"
  designLabel: "Narrative Review"
  populationLabel: "Participants in sauna studies, especially Finnish prospective cohort samples"
  durationLabel: "Sauna bathing frequency and related thermal practices"
  aggregateRole: "context"
  aggregationNote: "source-index.json absent from snapshot; fallback resolution used stable IDs plus visible source pages/artifact manifests/referenced keys | deduped 1 candidate row(s) from reviews-meta-guidelines | not found in available source pages, artifact manifests, or referenced content keys | Recent mixed bathing/sauna narrative review that may add source-recall leads but requires separation from Japanese bath exposure."
  cohortKey: "doi-10.3390-ijerph23030347"
evidenceBucket: "reviews_meta_guidelines"
directnessToProtocol: "adjacent_variant"
claimUse: "context-only"
murphV1Priority: "medium"
artifactRightsStatusGuess: "open_access"
sourceFindings:

  -
    findingId: "finding:doi-10.3390-ijerph23030347-sauna-observational-context"
    sourceKey: "source_artifact:doi-10.3390-ijerph23030347"
    extractedFromArtifactId: "art_doi_10_3390_ijerph23030347"
    findingKind: "context"
    population: "Participants in sauna studies, especially Finnish prospective cohort samples"
    exposure: "Sauna bathing frequency and related thermal practices"
    outcome: "Cardiovascular mortality, all-cause mortality, inflammatory markers, endothelial markers, and other systemic outcomes"
    summary: "The narrative review included 45 studies overall (17 bathing and 28 sauna) and states that sauna evidence is mainly from Finnish cohorts associating sauna use with lower cardiovascular and all-cause mortality and favorable inflammatory/endothelial markers, while emphasizing that longitudinal and interventional research with better-defined exposures is needed."
    evidenceUse:
      - "context"
  -
    findingId: "finding:doi-10.3390-ijerph23030347-sauna-safety-survey"
    sourceKey: "source_artifact:doi-10.3390-ijerph23030347"
    extractedFromArtifactId: "art_doi_10_3390_ijerph23030347"
    findingKind: "safety"
    population: "Global sauna users represented in survey and safety literature summarized by the review"
    exposure: "Sauna use"
    outcome: "Adverse effects and safety boundaries"
    summary: "The review summarizes safety literature indicating that dizziness, dehydration, and headache are common self-reported sauna effects, severe adverse events are rare in survey data, and alcohol-associated sauna deaths and other high-risk contexts require explicit risk assessment."
    evidenceUse:
      - "safety"
      - "context"
---

This source is included for **reviews meta guidelines**.

## Why it matters

Useful for landscape context and safety language, but not for causal protocol claims.

## Findings captured

- The narrative review included 45 studies overall (17 bathing and 28 sauna) and states that sauna evidence is mainly from Finnish cohorts associating sauna use with lower cardiovascular and all-cause mortality and favorable inflammatory/endothelial markers, while emphasizing that longitudinal and interventional research with better-defined exposures is needed.
- The review summarizes safety literature indicating that dizziness, dehydration, and headache are common self-reported sauna effects, severe adverse events are rare in survey data, and alcohol-associated sauna deaths and other high-risk contexts require explicit risk assessment.

## Protocol takeaway

Narrative review frames sauna evidence as mainly observational with safety considerations.

## Important limits

Narrative review and Finnish cohort evidence cannot establish that Murph protocol exposure causes outcomes.
