---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:crossfit-bottom-to-bottom-tabata-squat-2011-09-10
slug: sources/tabata-interval-training/crossfit-bottom-to-bottom-tabata-squat-2011-09-10
title: Workout of the Day: Saturday 110910 — Tabata “Bottom to Bottom” Squat
summary: Public CrossFit workout page that changes the 10-second rest interval into a mechanically demanding bottom-squat hold and adds a one-mile run, making it an adjacent stress-boundary variant rather than standard Tabata rest.
status: draft
quality: usable
aliases:
  - Tabata Bottom to Bottom Squat
  - Saturday 110910
categories:
  - tabata-interval-training
relations:
  -
    type: related_protocol
    target: protocol_variant:tabata-interval-training/tabata-20-10-interval-training
  -
    type: parent_family
    target: experiment_family:tabata-interval-training
canonicalMetadata:
  canonicalIdBasis: url
  url: https://www.crossfit.com/workout/2011/09/10
  sourceKind: web_page
sourceKind: web_page
source:
  kind: web_page
  title: Workout of the Day: Saturday 110910 — Tabata “Bottom to Bottom” Squat
  authors: CrossFit
  year: 2011
  journal: CrossFit Workout of the Day
  url: https://www.crossfit.com/workout/2011/09/10
  citation: CrossFit. Workout of the Day: Saturday 110910 — Tabata “Bottom to Bottom” Squat. CrossFit Workout of the Day. Published September 10, 2011. Accessed April 24, 2026. https://www.crossfit.com/workout/2011/09/10.
researchEvidence:
  designKind: other
  designLabel: External workout page
  populationLabel: Public CrossFit / functional-fitness participants
  durationLabel: Single Tabata squat variant followed by one-mile run
  cohortKey: crossfit-bottom-to-bottom-tabata-squat-2011-09-10
  aggregateRole: context
protocolEvidence:
  -
    protocolKey: protocol_variant:tabata-interval-training/tabata-20-10-interval-training
    groupId: external-tabata-style-disambiguation
    stance: context_only
    scope: adjacent_variant
    result: not_efficacy_evidence
    endpointKeys: []
    headline: Alters the 10-second rest into a bottom-squat hold and adds a running task.
    implication: Useful for warning that rest-interval substitutions materially change load and safety considerations.
    caveat: External workout page; no injury, rhabdomyolysis, or clinical safety event reporting.
    displayPriority: 70
evidenceBucket: external_protocol_claims
whyItMatters: It is a boundary example where nominal Tabata timing masks a rest-interval and workload change.
potentialMurphEndpoints:
  - rest posture
  - squat depth tolerance
  - post-interval running tolerance
  - musculoskeletal fatigue
protocolTakeaway: Rest intervals should be actual recovery unless a protocol deliberately marks a loaded-rest variant as adjacent and higher risk.
murphTakeaway: Use as a cautionary public-protocol variant for load substitution during rest periods.
studyDesign: External workout page; no original study design.
modality: Bodyweight squat Tabata variant plus running
directness: adjacent_variant
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
sourceExtractionBatch: 12-source-extraction-009
---
This source is included for **external_protocol_claims**.

**Findings:**
- The workout uses Tabata squats but requires the 10-second rest periods to be held in the bottom of a squat and then adds a one-mile run.
- This changes both recovery and total workload and should be treated as an adjacent variant, not standard Tabata 20/10.

**Why it matters:** It is a boundary example where nominal Tabata timing masks a rest-interval and workload change.

**Potential experiment signals:** rest posture, squat depth tolerance, post-interval running tolerance, musculoskeletal fatigue.

**Protocol takeaway:** Rest intervals should be actual recovery unless a protocol deliberately marks a loaded-rest variant as adjacent and higher risk.

**Limitations and boundaries:**
- No participant denominator, outcome measures, or adverse-event reporting.
- Rest-interval mechanics differ from standard rest and may alter musculoskeletal risk.
- Community workout prescription is not clinical safety evidence.

**Claim use:** `context-only`.
