---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:x-bryan-johnson-fired-review-2026-04-06"
slug: "sources/dry-sauna/x-bryan-johnson-fired-review-2026-04-06"
title: "I think I need to be fired. I've done 232 dry sauna sessions"
summary: "232-session review says the 20 min protocol missed a claimed core-temperature/HSP threshold."
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
  title: "I think I need to be fired. I've done 232 dry sauna sessions"
  url: "https://x.com/bryan_johnson/status/2041202370672288028"
  citation: "I think I need to be fired. I've done 232 dry sauna sessions. https://x.com/bryan_johnson/status/2041202370672288028"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "18ef8e179abeb5d0cbb4430abc3ba290628459a9070368eb5fa54cbacc485024"
    url: "https://x.com/bryan_johnson/status/2041202370672288028"
  canonicalUrl: "https://x.com/bryan_johnson/status/2041202370672288028"
researchEvidence:
  designKind: "other"
  designLabel: "Other"
  populationLabel: "Bryan Johnson; adult male N-of-1 self-experiment"
  durationLabel: "232 dry-sauna sessions using a standard daily 20 min protocol, followed by ingestible core-temperature measurement"
  aggregateRole: "context"
  aggregationNote: "source-index.json absent from snapshot; fallback resolution used stable IDs plus visible source pages/artifact manifests/referenced keys | deduped 1 candidate row(s) from external-protocol-claims | source key already referenced in available sauna/dry-sauna content graph | Social-source duplicate/early version of Blueprint core-temperature update; keep as provenance for changing public claims."
  cohortKey: "x-bryan-johnson-fired-review-2026-04-06"
evidenceBucket: "external_protocol_claims"
directnessToProtocol: "direct_protocol"
claimUse: "context-only"
murphV1Priority: "medium"
artifactRightsStatusGuess: "unknown"
sourceFindings:

  -
    findingId: "finding:x-bryan-johnson-fired-review-2026-04-06-232-sessions-core-temp-gap"
    sourceKey: "source_artifact:x-bryan-johnson-fired-review-2026-04-06"
    extractedFromArtifactId: "art_x_bryan_johnson_fired_review_2026_04_06_html"
    findingKind: "measurement_validation"
    population: "Bryan Johnson; adult male N-of-1 self-experiment"
    exposure: "232 dry-sauna sessions using a standard daily 20 min protocol, followed by ingestible core-temperature measurement"
    outcome: "Core-temperature threshold attainment"
    summary: "The post reports 232 dry-sauna sessions and states that 20 min at the standard dose was not enough for Bryan Johnson to reach the claimed 102.2°F (39.0°C) heat-shock threshold; it reports 33 min at 195°F, or 38 min with face and neck cooling, to reach that threshold."
    evidenceUse:
      - "measurement"
      - "context"
  -
    findingId: "finding:x-bryan-johnson-fired-review-2026-04-06-measurement-scope"
    sourceKey: "source_artifact:x-bryan-johnson-fired-review-2026-04-06"
    extractedFromArtifactId: "art_x_bryan_johnson_fired_review_2026_04_06_html"
    findingKind: "context"
    population: "Bryan Johnson; adult male N-of-1 self-experiment"
    exposure: "Longitudinal self-tracking during dry sauna"
    outcome: "Measured domains"
    summary: "The post says the 232 sessions tracked air temperature, humidity, duration, frequency, sweat output, blood biomarkers, vascular response, toxin clearance, and fertility markers, but that the key core-temperature threshold had not been confirmed until the pill test."
    evidenceUse:
      - "measurement"
      - "context"
  -
    findingId: "finding:x-bryan-johnson-fired-review-2026-04-06-hsp-not-confirmed"
    sourceKey: "source_artifact:x-bryan-johnson-fired-review-2026-04-06"
    extractedFromArtifactId: "art_x_bryan_johnson_fired_review_2026_04_06_html"
    findingKind: "mechanistic"
    population: "Bryan Johnson; adult male N-of-1 self-experiment"
    exposure: "High-heat dry sauna and core-temperature threshold framing"
    outcome: "Heat-shock protein mechanism"
    summary: "The post states that most dry-sauna studies do not identify heat-shock response and that intracellular HSP expression has not been addressed with dry sauna, making the HSP-threshold interpretation mechanistic and unconfirmed for the cited sauna-outcome studies."
    evidenceUse:
      - "mechanism"
      - "context"
  -
    findingId: "finding:x-bryan-johnson-fired-review-2026-04-06-self-reported-benefits"
    sourceKey: "source_artifact:x-bryan-johnson-fired-review-2026-04-06"
    extractedFromArtifactId: "art_x_bryan_johnson_fired_review_2026_04_06_html"
    findingKind: "intervention_result"
    population: "Bryan Johnson; adult male N-of-1 self-experiment"
    exposure: "Starting dry-sauna protocol over 232 sessions"
    outcome: "Vascular function, toxin clearance, microplastics, and fertility markers"
    summary: "The post reports persistent benefits from the starting protocol, including 10+ years reduction in vascular age, full detoxification of 3 of 6 environmental toxins with other reductions, 85% microplastic reduction in blood and semen, and fertility markers at an all-time high in 24 iced sessions; these are uncontrolled self-reported outcomes."
    evidenceUse:
      - "adjacent_variant"
      - "context"
  -
    findingId: "finding:x-bryan-johnson-fired-review-2026-04-06-gradual-progression-safety"
    sourceKey: "source_artifact:x-bryan-johnson-fired-review-2026-04-06"
    extractedFromArtifactId: "art_x_bryan_johnson_fired_review_2026_04_06_html"
    findingKind: "safety"
    population: "General readers of a public self-experiment post"
    exposure: "Dry-sauna sessions longer than 33 min at 190°F or above"
    outcome: "Heat tolerance, hydration, and fertility-protection caution"
    summary: "The post cautions that reaching longer sessions at 190°F or above takes time, recommends gradual progression, staying within personal heat-tolerance limits, hydration, and testicular cooling for men."
    evidenceUse:
      - "safety"
---

This source is included for **external protocol claims**.

## Why it matters

Useful for measurement uncertainty and mechanism-boundary framing, not for changing efficacy claims.

## Findings captured

- The post reports 232 dry-sauna sessions and states that 20 min at the standard dose was not enough for Bryan Johnson to reach the claimed 102.2°F (39.0°C) heat-shock threshold; it reports 33 min at 195°F, or 38 min with face and neck cooling, to reach that threshold.
- The post says the 232 sessions tracked air temperature, humidity, duration, frequency, sweat output, blood biomarkers, vascular response, toxin clearance, and fertility markers, but that the key core-temperature threshold had not been confirmed until the pill test.
- The post states that most dry-sauna studies do not identify heat-shock response and that intracellular HSP expression has not been addressed with dry sauna, making the HSP-threshold interpretation mechanistic and unconfirmed for the cited sauna-outcome studies.

## Protocol takeaway

232-session review says the 20 min protocol missed a claimed core-temperature/HSP threshold.

## Important limits

Original X page was not extractable here; full text was available from same-title mirrored posts. HSP expression was not measured directly.
