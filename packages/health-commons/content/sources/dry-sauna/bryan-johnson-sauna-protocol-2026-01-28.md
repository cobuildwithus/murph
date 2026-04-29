---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:bryan-johnson-sauna-protocol-2026-01-28"
slug: "sources/dry-sauna/bryan-johnson-sauna-protocol-2026-01-28"
title: "My #1 Longevity Protocol of 2025"
summary: "External N-of-1 sauna protocol reports biomarker improvements but with unresolved causality."
status: "draft"
quality: "usable"
categories:
  - "dry-sauna"
  - "external_protocol_claims"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week"
  -
    type: "parent_family"
    target: "experiment_family:dry-sauna"
source:
  kind: "external_protocol"
  title: "My #1 Longevity Protocol of 2025"
  url: "https://blueprint.bryanjohnson.com/blogs/news/sauna-protocol"
  citation: "My #1 Longevity Protocol of 2025. https://blueprint.bryanjohnson.com/blogs/news/sauna-protocol"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "15f2ee89d3f930049c204c5379ad71fa45d48e9d086bf7203c9c1ae55bd2a399"
    url: "https://blueprint.bryanjohnson.com/blogs/news/sauna-protocol"
  canonicalUrl: "https://blueprint.bryanjohnson.com/blogs/news/sauna-protocol"
researchEvidence:
  designKind: "other"
  designLabel: "Other"
  populationLabel: "Bryan Johnson; adult male N-of-1 self-experiment; broader literature summarized secondarily"
  durationLabel: "Dry sauna at 200°F (93°C), 5-20% relative humidity, 20 min daily, morning after workout"
  aggregateRole: "context"
  aggregationNote: "source-index.json absent from snapshot; fallback resolution used stable IDs plus visible source pages/artifact manifests/referenced keys | deduped 1 candidate row(s) from external-protocol-claims | source key already referenced in available sauna/dry-sauna content graph | Primary Blueprint source for Bryan Johnson's source-attributed routine and consumer-facing 80-100 C, 15-20 minute, 3-5x/week implementation language; not efficacy evidence."
  cohortKey: "bryan-johnson-sauna-protocol-2026-01-28"
evidenceBucket: "external_protocol_claims"
directnessToProtocol: "direct_protocol"
claimUse: "context-only"
murphV1Priority: "high"
artifactRightsStatusGuess: "unknown"
sourceFindings:

  -
    findingId: "finding:bryan-johnson-sauna-protocol-2026-01-28-dose"
    sourceKey: "source_artifact:bryan-johnson-sauna-protocol-2026-01-28"
    extractedFromArtifactId: "art_bryan_johnson_sauna_protocol_2026_01_28_html"
    findingKind: "context"
    population: "Bryan Johnson; adult male N-of-1 self-experiment; broader literature summarized secondarily"
    exposure: "Dry sauna at 200°F (93°C), 5-20% relative humidity, 20 min daily, morning after workout"
    outcome: "Protocol dose and practical at-home recommendation"
    summary: "The page reports Bryan Johnson's sauna protocol as dry sauna, 200°F (93°C), very low humidity, 20 min daily after workout, with rehydration and heat-protection measures; it also suggests at-home sauna at 176-212°F (80-100°C), 15-20 min, 3-5 times weekly."
    evidenceUse:
      - "adjacent_variant"
      - "context"
  -
    findingId: "finding:bryan-johnson-sauna-protocol-2026-01-28-toxins-microplastics"
    sourceKey: "source_artifact:bryan-johnson-sauna-protocol-2026-01-28"
    extractedFromArtifactId: "art_bryan_johnson_sauna_protocol_2026_01_28_html"
    findingKind: "intervention_result"
    population: "Bryan Johnson; adult male N-of-1 self-experiment"
    exposure: "Reported 15 dry-sauna sessions within a 30-day protocol"
    outcome: "Environmental toxin and microplastic measures"
    summary: "After 15 sessions, the page reports drops in several environmental toxin markers (including 65% for 2,4-D, 100% for MEP, 15% for MBP, 100% for MEHP, 56% for NAPR, 56% for HEMA, and 100% for perchlorate) and an 85% reduction of microplastics in ejaculate with a similar blood drop; methods and validation details are not provided in the extracted page."
    evidenceUse:
      - "adjacent_variant"
      - "context"
  -
    findingId: "finding:bryan-johnson-sauna-protocol-2026-01-28-fertility-without-ice"
    sourceKey: "source_artifact:bryan-johnson-sauna-protocol-2026-01-28"
    extractedFromArtifactId: "art_bryan_johnson_sauna_protocol_2026_01_28_html"
    findingKind: "adverse_event"
    population: "Bryan Johnson; adult male N-of-1 self-experiment"
    exposure: "Sauna exposure without testicular cooling"
    outcome: "Semen parameters"
    summary: "The page reports that sauna without testicular cooling was associated with worsened fertility markers: total motile count -56%, concentration -30%, motility -50%, morphology -48%, and count -9%."
    evidenceUse:
      - "safety"
  -
    findingId: "finding:bryan-johnson-sauna-protocol-2026-01-28-fertility-with-ice-uncertain"
    sourceKey: "source_artifact:bryan-johnson-sauna-protocol-2026-01-28"
    extractedFromArtifactId: "art_bryan_johnson_sauna_protocol_2026_01_28_html"
    findingKind: "intervention_result"
    population: "Bryan Johnson; adult male N-of-1 self-experiment"
    exposure: "Sauna exposure with testicular cooling"
    outcome: "Semen parameters"
    summary: "With testicular cooling, the page reports total count 600M, concentration 162M, motility 55%, total motile count 330M, and normal morphology 10%, while explicitly stating it is unknown whether the driver was sauna, sauna plus ice, or ice alone."
    evidenceUse:
      - "adjacent_variant"
      - "context"
      - "safety"
  -
    findingId: "finding:bryan-johnson-sauna-protocol-2026-01-28-vascular-function"
    sourceKey: "source_artifact:bryan-johnson-sauna-protocol-2026-01-28"
    extractedFromArtifactId: "art_bryan_johnson_sauna_protocol_2026_01_28_html"
    findingKind: "intervention_result"
    population: "Bryan Johnson; adult male N-of-1 self-experiment"
    exposure: "Daily dry-sauna protocol"
    outcome: "Vascular function markers"
    summary: "The page reports a claimed 10-year reduction in vascular age, with central systolic blood pressure 96 mmHg, central pulse pressure 20 mmHg, pulse pressure amplification 160%, SEVR 227%, augmentation pressure 1 mmHg, augmentation index wave 3%, and traditional blood pressure 107/75 mmHg; no comparator group is reported."
    evidenceUse:
      - "adjacent_variant"
      - "context"
  -
    findingId: "finding:bryan-johnson-sauna-protocol-2026-01-28-safety-boundaries"
    sourceKey: "source_artifact:bryan-johnson-sauna-protocol-2026-01-28"
    extractedFromArtifactId: "art_bryan_johnson_sauna_protocol_2026_01_28_html"
    findingKind: "safety"
    population: "General readers of a public sauna-protocol page"
    exposure: "Hot dry sauna at 176-212°F (80-100°C)"
    outcome: "Safety exclusions, hydration, skin, and tolerability"
    summary: "The page advises beginners to use the lower end of the 176-212°F range and flags headaches, severely dried nose and eyes, skin-barrier stress, dehydration/electrolyte replacement, and exclusions including serious heart issues, uncontrolled blood pressure, pregnancy, infection or fever, seizures, respiratory conditions, inflamed skin, recent alcohol or recreational drug use, and medications such as beta-blockers, stimulants, anticholinergics, or diuretics."
    evidenceUse:
      - "safety"
---

This source is included for **external protocol claims**.

## Why it matters

Can inform protocol-parameter context and candidate endpoints, not efficacy claims.

## Findings captured

- The page reports Bryan Johnson's sauna protocol as dry sauna, 200°F (93°C), very low humidity, 20 min daily after workout, with rehydration and heat-protection measures; it also suggests at-home sauna at 176-212°F (80-100°C), 15-20 min, 3-5 times weekly.
- After 15 sessions, the page reports drops in several environmental toxin markers (including 65% for 2,4-D, 100% for MEP, 15% for MBP, 100% for MEHP, 56% for NAPR, 56% for HEMA, and 100% for perchlorate) and an 85% reduction of microplastics in ejaculate with a similar blood drop; methods and validation details are not provided in the extracted page.
- The page reports that sauna without testicular cooling was associated with worsened fertility markers: total motile count -56%, concentration -30%, motility -50%, morphology -48%, and count -9%.

## Protocol takeaway

External N-of-1 sauna protocol reports biomarker improvements but with unresolved causality.

## Important limits

Single-person uncontrolled report, commercial/educational page, many co-interventions, and incomplete methods for toxin and microplastic measures.
