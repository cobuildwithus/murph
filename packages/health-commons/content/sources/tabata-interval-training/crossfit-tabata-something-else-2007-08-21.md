---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:crossfit-tabata-something-else-2007-08-21
slug: sources/tabata-interval-training/crossfit-tabata-something-else-2007-08-21
title: Workout of the Day: Tuesday 070821 — “Tabata Something Else”
summary: Public CrossFit workout page that keeps 20-second work and 10-second rest timing but expands it to 32 continuous intervals across four movements, making it an adjacent high-volume variant rather than a single original Tabata block.
status: draft
quality: usable
aliases:
  - Tabata Something Else
  - Tuesday 070821
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
    url: https://www.crossfit.com/workout/2007/08/21
  canonicalUrl: https://www.crossfit.com/workout/2007/08/21
sourceKind: web_page
source:
  kind: web_page
  title: Workout of the Day: Tuesday 070821 — “Tabata Something Else”
  authors: CrossFit
  year: 2007
  journal: CrossFit Workout of the Day
  url: https://www.crossfit.com/workout/2007/08/21
  citation: CrossFit. Workout of the Day: Tuesday 070821 — “Tabata Something Else”. CrossFit Workout of the Day. Published August 21, 2007. Accessed April 24, 2026. https://www.crossfit.com/workout/2007/08/21.
researchEvidence:
  designKind: other
  designLabel: External workout page
  populationLabel: Public CrossFit / functional-fitness participants
  durationLabel: Single workout: 32 continuous 20/10 intervals
  cohortKey: crossfit-tabata-something-else-2007-08-21
  aggregateRole: context
evidenceBucket: external_protocol_claims
whyItMatters: This source helps distinguish 20/10 timing from the full protocol dose; it is a public workout example, not efficacy evidence.
potentialMurphEndpoints:
  - interval count and work/rest fidelity
  - movement-specific repetition totals
  - fatigue and form breakdown across a longer mixed-modal block
protocolTakeaway: Do not treat all 20/10-labeled workouts as the original four-minute Tabata protocol; total intervals and movement stacking matter.
murphTakeaway: Use as context for protocol-name drift and high-volume functional-fitness variants only.
studyDesign: External workout page; no trial design, comparator, participant count, or adverse-event reporting.
modality: Mixed-modal bodyweight functional fitness
directness: adjacent_variant
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: unknown
sourceExtractionBatch: 12-source-extraction-009
---
This source is included for **external_protocol_claims**.

**Findings:**
- The page defines a named public workout using 32 consecutive 20-second work / 10-second rest intervals across pull-ups, push-ups, sit-ups, and squats.
- Because the workout has no rest between movement blocks and quadruples a single eight-interval block, it should be extracted as a dose-boundary example rather than efficacy support.

**Why it matters:** This source helps distinguish 20/10 timing from the full protocol dose; it is a public workout example, not efficacy evidence.

**Potential experiment signals:** interval count and work/rest fidelity, movement-specific repetition totals, fatigue and form breakdown across a longer mixed-modal block.

**Protocol takeaway:** Do not treat all 20/10-labeled workouts as the original four-minute Tabata protocol; total intervals and movement stacking matter.

**Limitations and boundaries:**
- No trial population or denominator.
- No health endpoints, adverse-event accounting, or follow-up.
- CrossFit benchmark scoring is a community performance context, not a clinical or biomarker outcome.

**Claim use:** `context-only`.
