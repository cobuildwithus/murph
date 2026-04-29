---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1093-cdn-nzab039_002
slug: sources/time-restricted-eating/doi-10.1093-cdn-nzab039_002
title: 'Feasibility of Three Different 8h Time-Restricted Eating Schedules Over 4 Weeks in Spanish Adults With Overweight/Obesity: A Pilot Randomized Controlled Trial'
summary: Pilot RCT comparing early, late, and self-selected 8-hour TRE schedules in Spanish adults with overweight/obesity; useful for timing-feasibility and adverse-event monitoring boundaries.
status: draft
quality: usable
aliases:
- doi-10.1093-cdn-nzab039_002
- doi:10.1093/cdn/nzab039_002
- 'Feasibility of Three Different 8h Time-Restricted Eating Schedules Over 4 Weeks in Spanish Adults With Overweight/Obesity: A Pilot Randomized Controlled Trial'
categories:
- time-restricted-eating
relations:
- type: related_protocol
  target: protocol_variant:time-restricted-eating/time-restricted-eating-18-6
- type: parent_family
  target: experiment_family:time-restricted-eating
source:
  kind: journal_article
  title: 'Feasibility of Three Different 8h Time-Restricted Eating Schedules Over 4 Weeks in Spanish Adults With Overweight/Obesity: A Pilot Randomized Controlled Trial'
  authors: Dote-Montero M; Sevilla-Lorente R; Merchán-Ramírez E; Ruiz JR; et al.
  year: 2021
  journal: Current Developments in Nutrition
  citation: 'Dote-Montero M; Sevilla-Lorente R; Merchán-Ramírez E; Ruiz JR; et al.. Feasibility of Three Different 8h Time-Restricted Eating Schedules Over 4 Weeks in Spanish Adults With Overweight/Obesity: A Pilot Randomized Controlled Trial. Current Developments in Nutrition. 2021. doi:10.1093/cdn/nzab039_002'
  doi: 10.1093/cdn/nzab039_002
  url: https://pmc.ncbi.nlm.nih.gov/articles/PMC8181397/
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1093/cdn/nzab039_002
    pmcid: PMC8181397
    titleHash: de57e1ed1e149b7bf4d37cfe7e4054b75f511abcb29907f62221efb2565ef711
    url: https://pmc.ncbi.nlm.nih.gov/articles/PMC8181397/
  canonicalUrl: https://pmc.ncbi.nlm.nih.gov/articles/PMC8181397/
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Pilot randomized trial comparing three 8-hour TRE schedule options
  populationLabel: Spanish adults with overweight or obesity and baseline eating window of at least 12 hours
  durationLabel: 4-week 8-hour TRE intervention
  aggregateRole: primary
  cohortKey: doi-10.1093-cdn-nzab039_002-spanish-8h-schedules
  participantCount: 22
  participantCountKind: reported
evidenceBucket: Graded windows and adjacent TRE variants
whyItMatters: Shows that an 8-hour target can be attempted in multiple schedule placements, while early windows may have lower week-by-week adherence than late or self-selected windows.
potentialMurphEndpoints:
- schedule adherence
- actual eating-window duration
- headache
- nausea
- acid reflux symptoms
- hunger
- cravings
- mood
- sleep quality
protocolTakeaway: For graded starter windows, allow self-selected or later schedules when early windows are hard; do not imply that all 8-hour schedules are equally feasible.
murphTakeaway: An 8-hour window is not just a duration—it is also a timing choice. User preference and workday fit can matter for adherence.
studyDesign: Pilot randomized controlled trial
modality: Time-restricted eating / daily eating-window restriction
claimUse: supports-protocol
sourceFindings:
- findingId: finding:doi-10.1093-cdn-nzab039_002:8h-schedule-feasibility
  sourceKey: source_artifact:doi-10.1093-cdn-nzab039_002
  extractedFromArtifactId: art-doi-10-1093-cdn-nzab039-002-pmc-html
  findingKind: intervention_result
  population: Spanish adults with overweight or obesity
  exposure: Early, late, or self-selected 8-hour TRE schedules over 4 weeks
  outcome: Completion, adherence, and achieved eating window
  summary: All 22 randomized participants completed the 4-week study; late and self-selected TRE maintained adherence of at least 95%, while early TRE adherence fell from 94% in week 1 to 68% in week 4.
  evidenceUse:
  - adjacent_variant
  - measurement
- findingId: finding:doi-10.1093-cdn-nzab039_002:no-serious-aes
  sourceKey: source_artifact:doi-10.1093-cdn-nzab039_002
  extractedFromArtifactId: art-doi-10-1093-cdn-nzab039-002-pmc-html
  findingKind: adverse_event
  population: Spanish adults with overweight or obesity in a pilot 8-hour TRE trial
  exposure: Three 8-hour TRE schedule placements
  outcome: Adverse events and symptoms
  summary: The pilot reported no serious adverse events and no between-group differences in headache, nausea, acidity, diarrhea, thirst, hunger, cravings, tiredness, stress, irritability, or anxiety eating.
  evidenceUse:
  - safety
  - adjacent_variant
- findingId: finding:doi-10.1093-cdn-nzab039_002:mood-sleep-signal
  sourceKey: source_artifact:doi-10.1093-cdn-nzab039_002
  extractedFromArtifactId: art-doi-10-1093-cdn-nzab039-002-pmc-html
  findingKind: context
  population: Spanish adults with overweight or obesity
  exposure: Early, late, or self-selected 8-hour TRE schedules
  outcome: Mood and sleep questionnaires
  summary: Early TRE showed within-group improvements in depression scores and a sleep-quality trend, but the abstract did not show robust between-schedule superiority; this should remain exploratory.
  evidenceUse:
  - context
murphV1Priority: High
pdfRightsStatus: open_access
directnessToProtocol: adjacent_variant
---
This source is included for **Graded windows and adjacent TRE variants**.

**Findings:** All 22 randomized participants completed the 4-week study; late and self-selected TRE maintained adherence of at least 95%, while early TRE adherence fell from 94% in week 1 to 68% in week 4. The pilot reported no serious adverse events and no between-group differences in headache, nausea, acidity, diarrhea, thirst, hunger, cravings, tiredness, stress, irritability, or anxiety eating. Early TRE showed within-group improvements in depression scores and a sleep-quality trend, but the abstract did not show robust between-schedule superiority; this should remain exploratory.

**Why it matters:** Shows that an 8-hour target can be attempted in multiple schedule placements, while early windows may have lower week-by-week adherence than late or self-selected windows.

**Potential experiment signals:** schedule adherence, actual eating-window duration, headache, nausea, acid reflux symptoms, hunger, cravings, mood, sleep quality.

**Protocol takeaway:** For graded starter windows, allow self-selected or later schedules when early windows are hard; do not imply that all 8-hour schedules are equally feasible.

**Claim use:** `supports-protocol`.

## Evidence boundary

Directness to `time-restricted-eating-18-6`: `adjacent_variant`. This page is source-owned; protocol-specific interpretation belongs in `packages/health-commons/content/evidence-appraisals/source-protocol-evidence/time-restricted-eating.jsonl`.
