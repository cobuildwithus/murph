---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:crossfit-tabata-this-2004-06-09
slug: sources/tabata-interval-training/crossfit-tabata-this-2004-06-09
title: Workout of the Day: Wednesday 040609 — “Tabata This!”
summary: Canonical public CrossFit benchmark page that explicitly defines a Tabata interval as 20 seconds of work followed by 10 seconds of rest for eight intervals, then applies it across five movements with one-minute rests between movements.
status: draft
quality: usable
aliases:
  - Tabata This!
  - Wednesday 040609
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
    url: https://www.crossfit.com/workout/2004/06/09
  canonicalUrl: https://www.crossfit.com/workout/2004/06/09
sourceKind: web_page
source:
  kind: web_page
  title: Workout of the Day: Wednesday 040609 — “Tabata This!”
  authors: CrossFit
  year: 2004
  journal: CrossFit Workout of the Day
  url: https://www.crossfit.com/workout/2004/06/09
  citation: CrossFit. Workout of the Day: Wednesday 040609 — “Tabata This!”. CrossFit Workout of the Day. Published June 9, 2004. Accessed April 24, 2026. https://www.crossfit.com/workout/2004/06/09.
researchEvidence:
  designKind: other
  designLabel: External workout page
  populationLabel: Public CrossFit / functional-fitness participants
  durationLabel: Five eight-interval Tabata blocks with one-minute rests between movements
  cohortKey: crossfit-tabata-this-2004-06-09
  aggregateRole: context
protocolEvidence:
  -
    protocolKey: protocol_variant:tabata-interval-training/tabata-20-10-interval-training
    groupId: external-tabata-style-disambiguation
    stance: context_only
    scope: direct_protocol
    result: not_efficacy_evidence
    endpointKeys: []
    headline: Defines the public 20/10 × 8 Tabata interval pattern but embeds it in a larger five-movement benchmark.
    implication: Useful for exact timing and scoring terminology while preserving the boundary that benchmark volume is larger than a single Tabata block.
    caveat: External benchmark programming; no controlled efficacy, biomarker, or adverse-event data.
    displayPriority: 50
evidenceBucket: external_protocol_claims
whyItMatters: It anchors a widely copied public definition of 20/10 × 8 while showing how public benchmarks can multiply the original dose.
potentialMurphEndpoints:
  - 20/10 timing fidelity
  - least-repetition interval score
  - movement-specific rep output
  - workout completion burden
protocolTakeaway: The page can support terminology for the 20/10 interval structure but not health-effect claims.
murphTakeaway: Use as context for public workout naming, scoring, and multi-exercise Tabata overload.
studyDesign: External workout page; no trial design, comparator, participant count, or adverse-event reporting.
modality: Rowing plus bodyweight functional-fitness benchmark
directness: direct_protocol
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: unknown
sourceExtractionBatch: 12-source-extraction-009
---
This source is included for **external_protocol_claims**.

**Findings:**
- The source defines each Tabata interval as 20 seconds of work followed by 10 seconds of rest for eight intervals.
- It applies that interval pattern to rowing, squats, pull-ups, push-ups, and sit-ups, with one minute of rest between movements and scoring based on the lowest interval score per movement.

**Why it matters:** It anchors a widely copied public definition of 20/10 × 8 while showing how public benchmarks can multiply the original dose.

**Potential experiment signals:** 20/10 timing fidelity, least-repetition interval score, movement-specific rep output, workout completion burden.

**Protocol takeaway:** The page can support terminology for the 20/10 interval structure but not health-effect claims.

**Limitations and boundaries:**
- Community benchmark score is not a validated health endpoint.
- The five-block workout is not the same exposure as one four-minute Tabata block.
- No safety events or population denominator are reported.

**Claim use:** `context-only`.
