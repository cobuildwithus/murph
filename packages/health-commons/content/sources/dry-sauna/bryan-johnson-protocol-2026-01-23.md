---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:bryan-johnson-protocol-2026-01-23
slug: sources/dry-sauna/bryan-johnson-protocol-2026-01-23
title: Bryan Johnson's Protocol
summary: Protocol website page listing a daily dry-sauna routine, groin ice, mineral-supplemented water, general-user tips, safety cautions, and one-person outcome claims; it contains an internal 175°F/93°C temperature mismatch.
status: draft
quality: usable
aliases:
- DON’T DIE protocol sauna section
- protocol.bryanjohnson.com sauna protocol
- source_artifact:protocol-bryanjohnson-dont-die-protocol-2026-04-27
categories:
- dry-sauna
- bryan-johnson-blueprint
relations:
- type: related_protocol
  target: protocol_variant:dry-sauna/bryan-johnson-blueprint
- type: parent_family
  target: experiment_family:dry-sauna
source:
  kind: web_page
  title: Bryan Johnson's Protocol
  authors: Bryan Johnson
  year: 2026
  journal: DON’T DIE / protocol.bryanjohnson.com
  citation: Johnson B. Bryan Johnson’s Protocol. DON’T DIE / protocol.bryanjohnson.com. Accessed in the April 2026 research snapshot.
  url: https://protocol.bryanjohnson.com
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: b063f2f21a86755d9d271d3a41309904f023d08c37401e6235e749ab90525e3c
    url: https://protocol.bryanjohnson.com
  canonicalUrl: https://protocol.bryanjohnson.com
researchEvidence:
  designKind: expert_protocol
  designLabel: Self-authored external protocol page
  populationLabel: Bryan Johnson self-report plus general protocol audience
  durationLabel: Daily 20-minute sessions; reported outcomes after 15, 23, and 27 sessions
  aggregateRole: primary
  cohortKey: bryan-johnson-protocol-2026-01-23
  participantCount: 1
  participantCountKind: reported
evidenceBucket: Direct external-protocol provenance and self-experiment claims
whyItMatters: Provides the broad public protocol wording and safety exclusions, while exposing a temperature inconsistency that must be preserved.
potentialMurphEndpoints:
- hydration
- safety exclusions
- resting heart rate
- morning blood pressure
- fertility-risk boundary
protocolTakeaway: Use for protocol provenance, hydration, and safety boundaries; do not use the personal outcome claims as expected effects.
murphTakeaway: The page supports routine wording and caution-screen content but should not be treated as independent efficacy evidence.
studyDesign: External protocol page with uncontrolled one-person outcome claims
modality: Dry sauna protocol
claimUse: supports-protocol
sourceFindings:
- findingId: finding:bryan-johnson-protocol-2026-01-23-dose
  sourceKey: source_artifact:bryan-johnson-protocol-2026-01-23
  extractedFromArtifactId: art_bryan_johnson_protocol_2026_01_23_web
  findingKind: context
  population: Bryan Johnson; adult male self-tracker and protocol audience.
  exposure: 'Dry sauna protocol page: daily 20-minute sessions, groin ice pack, 36 oz mineral-supplemented water; page lists 175°F (93°C), a Fahrenheit/Celsius unit mismatch.'
  outcome: Protocol dose, hydration, and unit-mismatch boundary.
  summary: The protocol site lists dry sauna, daily seven days per week, 20-minute sessions, groin ice protection, and 36 oz mineral-supplemented water; the listed temperature appears internally inconsistent as 175°F and 93°C are not equivalent.
  evidenceUse:
  - context
- findingId: finding:bryan-johnson-protocol-2026-01-23-safety
  sourceKey: source_artifact:bryan-johnson-protocol-2026-01-23
  extractedFromArtifactId: art_bryan_johnson_protocol_2026_01_23_web
  findingKind: safety
  population: General protocol audience.
  exposure: General dry-sauna tips and caution list.
  outcome: Safety exclusions and conservative use conditions.
  summary: The page advises 3–5 sessions/week of 15–20 minutes at 175–194°F for general users, hydration, caution above 194°F, and skipping sauna for serious heart issues, uncontrolled blood pressure, pregnancy without clinician input, fever/infection, seizures, respiratory conditions, inflamed skin, recent alcohol/recreational-drug use, or beta-blocker/stimulant/anticholinergic/diuretic use.
  evidenceUse:
  - safety
- findingId: finding:bryan-johnson-protocol-2026-01-23-reported-results
  sourceKey: source_artifact:bryan-johnson-protocol-2026-01-23
  extractedFromArtifactId: art_bryan_johnson_protocol_2026_01_23_web
  findingKind: intervention_result
  population: Bryan Johnson; one-person self-report.
  exposure: Fifteen to twenty-seven sauna sessions, partly described as 20 minutes at 200°F, with groin icing for some fertility observations.
  outcome: Self-reported changes in toxins, vascular markers, resting heart rate, and fertility markers.
  summary: The page reports reductions in selected environmental toxins after 15 sessions, central-pressure and resting-heart-rate changes at 23 sessions, and fertility-marker improvements after 27 sessions with groin ice, while also reporting fertility-marker damage after 15 sessions without ice. These are uncontrolled one-person claims.
  evidenceUse:
  - context
  - safety
murphV1Priority: High
pdfRightsStatus: unknown
sourceIndexResolution:
  sourceIndexStatus: absent_from_uploaded_repo_snapshot
  identityResolutionStatus: new_source
  canonicalSourceKey: null
  ledgerNotes: 'Generated source-index.json was absent from repo.snapshot; resolved against available source pages/artifact manifests and candidate identities only. Canonicalized duplicate proposed keys: source_artifact:protocol-bryanjohnson-dont-die-protocol-2026-04-27. Multiple candidate URLs in dedupe group; canonical URL selected from preferred representative; alternates were treated as mirrors/aliases, not independent evidence. Candidate shards: 02-discovery-direct-external-protocol, 08-discovery-fertility-groin-cooling.'
---

This source is included for **Direct external-protocol provenance and self-experiment claims**.

**Findings:** The page records sauna duration/frequency, hydration, groin ice, user cautions, and uncontrolled personal outcome claims.

**Why it matters:** It is a direct source for Bryan Johnson’s public protocol wording, but its 175°F/93°C mismatch is a material extraction caveat.

**Potential experiment signals:** hydration, RHR, morning blood pressure, symptoms, medication/condition exclusions, and fertility-risk discussion.

**Protocol takeaway:** Use for routine and safety provenance only; do not render the outcome claims as expected user results.

**Claim use:** `supports-protocol` for protocol provenance; personal results are `context-only` in the appraisal ledger.
