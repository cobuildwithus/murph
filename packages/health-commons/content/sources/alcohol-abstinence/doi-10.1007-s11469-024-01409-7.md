---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1007-s11469-024-01409-7
slug: sources/alcohol-abstinence/doi-10.1007-s11469-024-01409-7
title: 'ABC-Training for alcohol use during a voluntary abstinence challenge: a randomized controlled trial'
summary: Direct or near-direct abstinence-challenge source that requires careful boundary handling.
status: draft
quality: usable
aliases:
- 'ABC-Training for alcohol use during a voluntary abstinence challenge: a randomized controlled trial'
categories:
- alcohol-abstinence
relations:
-
  type: related_protocol
  target: protocol_variant:alcohol-abstinence/short-term-alcohol-abstinence
-
  type: parent_family
  target: experiment_family:alcohol-abstinence
source:
  kind: journal_article
  title: 'ABC-Training for alcohol use during a voluntary abstinence challenge: a randomized controlled trial'
  authors: Ting Pan; Veronica Szpak; Judith Laverman; Pieter Van Dessel; Rob Bovens; Helle Larsen; Reinout W. Wiers
  year: 2024
  journal: International Journal of Mental Health and Addiction
  citation: 'Ting Pan; Veronica Szpak; Judith Laverman; Pieter Van Dessel; Rob Bovens; Helle Larsen; Reinout W. Wiers; ABC-Training for alcohol use during a voluntary abstinence challenge: a randomized controlled trial; International Journal of Mental Health and Addiction; 2024; doi:10.1007/s11469-024-01409-7'
  doi: 10.1007/s11469-024-01409-7
  url: https://link.springer.com/article/10.1007/s11469-024-01409-7
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1007/s11469-024-01409-7
    titleHash: 5e40f7bb0d7c1576ab4c40483401733292725d98f63c5bbce97f61f08ff3c1a0
    url: https://link.springer.com/article/10.1007/s11469-024-01409-7
  canonicalUrl: https://doi.org/10.1007/s11469-024-01409-7
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: randomized controlled trial
  participantCount: 580
  participantCountKind: reported
  populationLabel: Dutch voluntary abstinence challenge participants in IkPas, mean ages over 50 in the extracted trials
  durationLabel: Challenge period with baseline, mid, post, 2-week, 3-month, and 6-month assessments
  aggregateRole: primary
  cohortKey: doi-10.1007-s11469-024-01409-7
evidenceBucket: Mood, craving, quality-of-life, replacement-behavior, and social context
whyItMatters: Included for mood, craving, quality-of-life, replacement-behavior, and social context. Direct challenge setting with adjacent support-intervention focus.
potentialMurphEndpoints:
- days abstinent
- binge days
- follow-up alcohol consumption
- abstinence success
- craving
protocolTakeaway: 'Use boundary: context-only. Training add-on trial, not a pure abstinence challenge efficacy study; older Dutch volunteer sample; attrition and exploratory findings limit claims.'
murphTakeaway: Track relevant endpoints but do not synthesize beyond this source. Direct challenge setting but evaluates support training arms rather than the challenge alone.
studyDesign: randomized controlled trial
modality: ABC-training during a voluntary abstinence challenge
claimUse: context-only
sourceFindings:
-
  findingId: finding:doi-10.1007-s11469-024-01409-7-abc-abstinence-challenge-mixed-results
  sourceKey: source_artifact:doi-10.1007-s11469-024-01409-7
  extractedFromArtifactId: art_doi_10_1007_s11469_024_01409_7
  findingKind: intervention_result
  population: Dutch voluntary abstinence challenge participants in IkPas, mean ages over 50 in the extracted trials
  exposure: ABC-training during a voluntary abstinence challenge
  outcome: days abstinent; binge days; follow-up alcohol consumption; abstinence success; craving
  summary: 'Pre-registered outcomes did not differ significantly by condition in two RCTs; exploratory analyses suggested higher abstinence success in ABC-training groups. Safety note: No clinical adverse events extracted; engagement and online voluntary setting are implementation considerations.'
  evidenceUse:
  - adjacent_variant
  - efficacy
  - context
murphV1Priority: Medium
pdfRightsStatus: open_access
directness: adjacent_variant
---


## Extraction notes

- **Study design:** randomized_controlled_trial
- **Participant count:** 580 (reported_total_across_two_studies)
- **Population:** Dutch voluntary abstinence challenge participants in IkPas, mean ages over 50 in the extracted trials
- **Intervention or exposure:** ABC-training during a voluntary abstinence challenge
- **Comparator or control:** Approach-bias modification and sham approach-bias modification conditions
- **Duration or follow-up:** Challenge period with baseline, mid, post, 2-week, 3-month, and 6-month assessments
- **Endpoints:** days abstinent, binge days, follow-up alcohol consumption, abstinence success, craving
- **Effect estimates or direction:** Pre-registered outcomes did not differ significantly by condition in two RCTs; exploratory analyses suggested higher abstinence success in ABC-training groups.
- **Adverse events or safety notes:** No clinical adverse events extracted; engagement and online voluntary setting are implementation considerations.
- **Limitations:** Training add-on trial, not a pure abstinence challenge efficacy study; older Dutch volunteer sample; attrition and exploratory findings limit claims.
- **Population mismatch:** Direct challenge setting but evaluates support training arms rather than the challenge alone.
- **Directness to protocol:** direct challenge setting with adjacent support-intervention focus
- **Claim-use boundary:** context-only
- **Artifact candidates and rights status:** metadata/landing-page candidate only; rights status open_access; no PDF vendored
