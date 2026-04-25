---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:trainingpeaks-40-20-tabata-2026-04-24
slug: sources/tabata-interval-training/trainingpeaks-40-20-tabata-2026-04-24
title: How 40/20 Intervals Can Improve Your Performance
summary: TrainingPeaks coaching article that explicitly places 40-second work / 20-second recovery intervals under a Tabata umbrella, making it a key altered-ratio public-claim boundary source.
status: draft
quality: usable
aliases:
  - TrainingPeaks 40/20 intervals
  - 40/20 Tabata
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
    url: https://www.trainingpeaks.com/blog/work-to-rest-ratio-the-benefits-of-40-20-workouts/
  canonicalUrl: https://www.trainingpeaks.com/blog/work-to-rest-ratio-the-benefits-of-40-20-workouts/
sourceKind: web_page
source:
  kind: web_page
  title: How 40/20 Intervals Can Improve Your Performance
  authors: Rick Kattouf
  journal: TrainingPeaks
  url: https://www.trainingpeaks.com/blog/work-to-rest-ratio-the-benefits-of-40-20-workouts/
  citation: Kattouf R. How 40/20 Intervals Can Improve Your Performance. TrainingPeaks. Accessed April 24, 2026. https://www.trainingpeaks.com/blog/work-to-rest-ratio-the-benefits-of-40-20-workouts/.
researchEvidence:
  designKind: other
  designLabel: Coaching article
  populationLabel: Endurance athletes and coaches
  durationLabel: Describes 40/20 interval workouts; not the 20/10 Tabata dose
  cohortKey: trainingpeaks-40-20-tabata-2026-04-24
  aggregateRole: context
evidenceBucket: external_protocol_claims
whyItMatters: It is a clear altered-ratio example showing that public Tabata terminology can drift from 20/10 to 40/20.
potentialMurphEndpoints:
  - work/rest ratio
  - athlete training status
  - session intensity
  - total session duration
protocolTakeaway: 40/20 intervals should be treated as adjacent HIIT or Tabata-style programming, not direct Tabata 20/10 evidence.
murphTakeaway: Use to guard against importing endurance-training 40/20 claims into 20/10 protocol claims.
studyDesign: Coaching article; no original study design.
modality: Endurance and strength-conditioning interval programming
directness: adjacent_variant
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: unknown
sourceExtractionBatch: 12-source-extraction-009
---
This source is included for **external_protocol_claims**.

**Findings:**
- The article describes 40-second work intervals followed by 20 seconds of rest or active recovery and frames them as part of a Tabata umbrella.
- Because the work/rest ratio is 40/20 rather than 20/10, findings from this source belong in adjacent-variant and terminology-boundary sections only.

**Why it matters:** It is a clear altered-ratio example showing that public Tabata terminology can drift from 20/10 to 40/20.

**Potential experiment signals:** work/rest ratio, athlete training status, session intensity, total session duration.

**Protocol takeaway:** 40/20 intervals should be treated as adjacent HIIT or Tabata-style programming, not direct Tabata 20/10 evidence.

**Limitations and boundaries:**
- No direct 20/10 intervention or comparator is extracted.
- Performance claims are coaching claims, not a controlled trial record.
- Population is athlete/coaching oriented and may not generalize to beginners or clinical users.

**Claim use:** `context-only`.
