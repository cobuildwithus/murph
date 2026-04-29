---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:ncceh-sauna-safety-2026-01-16"
slug: "sources/dry-sauna/ncceh-sauna-safety-2026-01-16"
title: "Rapid review: Environmental health risks and safety considerations in saunas"
summary: "NCCEH rapid review maps environmental and physiological hazards in sauna settings."
status: "draft"
quality: "usable"
categories:
  - "dry-sauna"
  - "safety_contraindications"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week"
  -
    type: "parent_family"
    target: "experiment_family:dry-sauna"
source:
  kind: "guideline"
  title: "Rapid review: Environmental health risks and safety considerations in saunas"
  url: "https://ncceh.ca/resources/evidence-briefs/rapid-review-environmental-health-risks-and-safety-considerations-saunas"
  citation: "Rapid review: Environmental health risks and safety considerations in saunas. https://ncceh.ca/resources/evidence-briefs/rapid-review-environmental-health-risks-and-safety-considerations-saunas"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "8afd243388ff3386433a3fc3a983b55c602ed5370ff5f6b82509ac27f81bd010"
    url: "https://ncceh.ca/resources/evidence-briefs/rapid-review-environmental-health-risks-and-safety-considerations-saunas"
  canonicalUrl: "https://ncceh.ca/resources/evidence-briefs/rapid-review-environmental-health-risks-and-safety-considerations-saunas"
researchEvidence:
  designKind: "narrative_review"
  designLabel: "Narrative Review"
  populationLabel: "Public dry and steam sauna environments"
  durationLabel: "Sauna environment and operation"
  aggregateRole: "context"
  aggregationNote: "source-index.json absent from snapshot; fallback resolution used stable IDs plus visible source pages/artifact manifests/referenced keys | deduped 3 candidate row(s) from external-protocol-claims, reviews-meta-guidelines, snowball-gap-fill | proposed keys: source_artifact:ncceh-sauna-safety-2026-01-16, source_artifact:ncceh-sauna-safety-2026-04-27 | not found in available source pages, artifact manifests, or referenced content keys | Best public-health safety source found for dry sauna risks, temperature ranges, supervision, sanitation, ventilation, and user warnings."
  cohortKey: "ncceh-sauna-safety-2026-01-16"
evidenceBucket: "safety_contraindications"
directnessToProtocol: "general_guideline"
claimUse: "safety-only"
murphV1Priority: "high"
artifactRightsStatusGuess: "unknown"
sourceFindings:

  -
    findingId: "finding:ncceh-sauna-hazard-categories"
    sourceKey: "source_artifact:ncceh-sauna-safety-2026-01-16"
    extractedFromArtifactId: "art_ncceh_sauna_safety_web"
    findingKind: "safety"
    population: "Public dry and steam sauna environments"
    exposure: "Sauna environment and operation"
    outcome: "Microbiological, physical, chemical, and heat-exposure hazards"
    summary: "NCCEH identifies microbiological, physical, chemical, and adverse physiological heat-exposure hazards in dry and steam saunas."
    evidenceUse:
      - "safety"
  -
    findingId: "finding:ncceh-sauna-infection-and-surface-risks"
    sourceKey: "source_artifact:ncceh-sauna-safety-2026-01-16"
    extractedFromArtifactId: "art_ncceh_sauna_safety_web"
    findingKind: "safety"
    population: "Communal sauna users"
    exposure: "Contact with sauna surfaces and shared sauna settings"
    outcome: "Surface contamination and infection risks"
    summary: "The review discusses microbial shedding, fungal and bacterial contamination, and a reported MRSA outbreak context, emphasizing cleaning, pre-sauna showers, and seating barriers."
    evidenceUse:
      - "safety"
  -
    findingId: "finding:ncceh-sauna-heat-injury-risks"
    sourceKey: "source_artifact:ncceh-sauna-safety-2026-01-16"
    extractedFromArtifactId: "art_ncceh_sauna_safety_web"
    findingKind: "adverse_event"
    population: "Sauna users, especially with prolonged exposure, alcohol/drugs/medication, or vulnerable conditions"
    exposure: "Dry/steam sauna heat exposure"
    outcome: "Heat stroke, syncope, burns, rhabdomyolysis, ocular irritation, death"
    summary: "The review lists sauna-related adverse outcomes including heat stroke, heat exhaustion, syncope, hyperthermia, burns after loss of consciousness, rhabdomyolysis, myocardial ischemia in unstable coronary disease, and death in prolonged exposures."
    evidenceUse:
      - "safety"
---

This source is included for **safety contraindications**.

## Why it matters

Strong source for safety boundaries, cleaning, ventilation, signage, and high-risk-user exclusions.

## Findings captured

- NCCEH identifies microbiological, physical, chemical, and adverse physiological heat-exposure hazards in dry and steam saunas.
- The review discusses microbial shedding, fungal and bacterial contamination, and a reported MRSA outbreak context, emphasizing cleaning, pre-sauna showers, and seating barriers.
- The review lists sauna-related adverse outcomes including heat stroke, heat exhaustion, syncope, hyperthermia, burns after loss of consciousness, rhabdomyolysis, myocardial ischemia in unstable coronary disease, and death in prolonged exposures.

## Protocol takeaway

NCCEH rapid review maps environmental and physiological hazards in sauna settings.

## Important limits

Rapid review of hazards, not an efficacy study; directness varies by hazard type.
