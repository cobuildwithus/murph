---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:wodwell-tabata-this-2026-04-24
slug: sources/tabata-interval-training/wodwell-tabata-this-2026-04-24
title: “Tabata This” Workout, CrossFit Benchmark WOD
summary: Public workout-library entry for the CrossFit benchmark “Tabata This,” preserving exact 20/10 × 8 timing within each movement while presenting a larger multi-movement benchmark dose.
status: draft
quality: usable
aliases:
  - WODwell Tabata This
  - Tabata This CrossFit Benchmark WOD
categories:
  - tabata-interval-training
relations:
  -
    type: related_protocol
    target: protocol_variant:tabata-interval-training/tabata-20-10-interval-training
  -
    type: parent_family
    target: experiment_family:tabata-interval-training
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://wodwell.com/wod/tabata-this/
  canonicalUrl: https://wodwell.com/wod/tabata-this/
sourceKind: web_page
source:
  kind: web_page
  title: “Tabata This” Workout, CrossFit Benchmark WOD
  authors: WODwell
  journal: WODwell workout library
  url: https://wodwell.com/wod/tabata-this/
  citation: WODwell. “Tabata This” Workout, CrossFit Benchmark WOD. WODwell. Accessed April 24, 2026. https://wodwell.com/wod/tabata-this/.
researchEvidence:
  designKind: other
  designLabel: Workout-library entry
  populationLabel: Public functional-fitness workout-library users
  durationLabel: Five Tabata blocks with one-minute rests after the first four blocks
  cohortKey: wodwell-tabata-this-2026-04-24
  aggregateRole: context
evidenceBucket: external_protocol_claims
whyItMatters: It shows how an exact Tabata timer pattern can be embedded in a much larger benchmark workout.
potentialMurphEndpoints:
  - number of Tabata blocks
  - movement list
  - work/rest fidelity
  - community workout score
protocolTakeaway: A page preserving 20/10 timing can still be dose-mismatched if it stacks several Tabata blocks.
murphTakeaway: Use as context for public benchmark dosing and naming only.
studyDesign: Workout-library entry; no original study design.
modality: Functional-fitness benchmark workout
directness: direct_protocol
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: unknown
sourceExtractionBatch: 12-source-extraction-009
---
This source is included for **external_protocol_claims**.

**Findings:**
- The WODwell entry presents a five-block benchmark in which each block follows eight rounds of 20 seconds work and 10 seconds rest, with one-minute rests between early blocks.
- This is useful for direct timing terminology but not for direct single-block protocol claims.

**Why it matters:** It shows how an exact Tabata timer pattern can be embedded in a much larger benchmark workout.

**Potential experiment signals:** number of Tabata blocks, movement list, work/rest fidelity, community workout score.

**Protocol takeaway:** A page preserving 20/10 timing can still be dose-mismatched if it stacks several Tabata blocks.

**Limitations and boundaries:**
- No participant count or outcome measurement.
- Community benchmark context differs from laboratory Tabata exposure.
- No adverse events are reported.

**Claim use:** `context-only`.
