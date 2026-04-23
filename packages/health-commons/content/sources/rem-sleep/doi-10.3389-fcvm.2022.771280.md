---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.3389-fcvm.2022.771280
slug: sources/rem-sleep/doi-10.3389-fcvm.2022.771280
title: Increased REM Sleep and Reduced Heart Failure Risk
summary: Sleep Heart Health Study analysis associating higher PSG-measured REM sleep percentage and total REM time with lower incident heart failure risk.
status: draft
quality: usable
categories:
  - rem-sleep
  - sleep-architecture
  - cardiovascular-risk
relations:
  -
    type: measures
    target: biomarker:rem-sleep-minutes
source:
  kind: journal_article
  title: Increased Rapid Eye Movement Sleep Is Associated With a Reduced Risk of Heart Failure in Middle-Aged and Older Adults
  authors: Zhao X; et al.
  year: 2022
  journal: Frontiers in Cardiovascular Medicine
  citation: 'Zhao X, et al. Increased Rapid Eye Movement Sleep Is Associated With a Reduced Risk of Heart Failure in Middle-Aged and Older Adults. Front Cardiovasc Med. 2022;9:771280.'
  doi: 10.3389/fcvm.2022.771280
  url: https://www.frontiersin.org/journals/cardiovascular-medicine/articles/10.3389/fcvm.2022.771280/full
researchEvidence:
  designKind: prospective_cohort
  designLabel: Community cohort analysis
  participantCount: 4490
  participantCountKind: reported
  durationLabel: Median follow-up after baseline PSG in Sleep Heart Health Study participants
  populationLabel: Middle-aged and older adults without baseline heart failure
  aggregateRole: context
  aggregationNote: Association evidence from a single baseline PSG night; not an intervention trial.
evidenceBucket: Outcome association
whyItMatters: Adds cardiovascular-outcome context for REM sleep while preserving the limitation that association does not establish causality.
potentialMurphEndpoints:
  - PSG REM percentage
  - total REM sleep time
  - incident heart failure
murphTakeaway: REM sleep may be an informative sleep-architecture marker in cohort risk models, but Murph should treat wearable REM as supportive context rather than a standalone cardiovascular endpoint.
---

This source gives Murph cardiovascular context for REM sleep without turning REM minutes into a treatment target. It is most useful for the page’s “why people care” and “do not overclaim” copy.
