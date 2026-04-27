---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1371-journal.pone.0142877
slug: sources/alcohol-abstinence/doi-10.1371-journal.pone.0142877
title: 'An Interactive Text Message Intervention to Reduce Binge Drinking in Young Adults: A Randomized Controlled Trial with 9-Month Outcomes'
summary: Context source for mood, craving, social friction, replacement behavior, or adjacent digital support.
status: draft
quality: usable
aliases:
- 'An Interactive Text Message Intervention to Reduce Binge Drinking in Young Adults: A Randomized Controlled Trial with 9-Month Outcomes'
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
  title: 'An Interactive Text Message Intervention to Reduce Binge Drinking in Young Adults: A Randomized Controlled Trial with 9-Month Outcomes'
  authors: Brian Suffoletto; Jeffrey Kristan; Tammy Chung; Kwonho Jeong; Anthony Fabio; Peter Monti; Duncan Clark
  year: 2015
  journal: PLOS ONE
  citation: 'Brian Suffoletto; Jeffrey Kristan; Tammy Chung; Kwonho Jeong; Anthony Fabio; Peter Monti; Duncan Clark; An Interactive Text Message Intervention to Reduce Binge Drinking in Young Adults: A Randomized Controlled Trial with 9-Month Outcomes; PLOS ONE; 2015; doi:10.1371/journal.pone.0142877'
  doi: 10.1371/journal.pone.0142877
  url: https://doi.org/10.1371/journal.pone.0142877
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1371/journal.pone.0142877
    titleHash: d8d69980ec592b8aa00ec87270603e09e8b46ecadb0bc30cc033c81015a568f5
    url: https://doi.org/10.1371/journal.pone.0142877
  canonicalUrl: https://doi.org/10.1371/journal.pone.0142877
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: randomized controlled trial
  participantCount: 765
  participantCountKind: reported
  populationLabel: Young adults aged 18–25 with hazardous drinking recruited from emergency departments
  durationLabel: 12-week intervention with 3-, 6-, and 9-month follow-up
  aggregateRole: primary
  cohortKey: doi-10.1371-journal.pone.0142877
evidenceBucket: Mood, craving, quality-of-life, replacement-behavior, and social context
whyItMatters: Included for mood, craving, quality-of-life, replacement-behavior, and social context. Adjacent digital alcohol-reduction comparator.
potentialMurphEndpoints:
- binge drinking days
- binge prevalence
- drinks per drinking day
- alcohol-related injury
- retention
protocolTakeaway: 'Use boundary: context-only. Young emergency-department sample, binge-reduction goal, and attrition; not an abstinence challenge.'
murphTakeaway: Track relevant endpoints but do not synthesize beyond this source. Binge-drinking reduction intervention rather than temporary complete abstinence.
studyDesign: randomized controlled trial
modality: 12-week interactive text-message assessment and feedback intervention
claimUse: context-only
sourceFindings:
-
  findingId: finding:doi-10.1371-journal.pone.0142877-sms-binge-drinking-reduction
  sourceKey: source_artifact:doi-10.1371-journal.pone.0142877
  extractedFromArtifactId: art_doi_10_1371_journal_pone_0142877
  findingKind: intervention_result
  population: Young adults aged 18–25 with hazardous drinking recruited from emergency departments
  exposure: 12-week interactive text-message assessment and feedback intervention
  outcome: binge drinking days; binge prevalence; drinks per drinking day; alcohol-related injury; retention
  summary: 'At 9 months, assessment-plus-feedback had fewer binge drinking days, lower binge prevalence, fewer drinks per drinking day, and lower alcohol-related injury versus control; assessment-only did not show the same reduction. Safety note: Alcohol-related injury was an outcome with lower odds in the intervention group; no abstinence-challenge adverse-event evidence.'
  evidenceUse:
  - adjacent_variant
  - context
murphV1Priority: Medium
pdfRightsStatus: open_access
---


## Extraction notes

- **Study design:** randomized_controlled_trial
- **Participant count:** 765 (reported)
- **Population:** Young adults aged 18–25 with hazardous drinking recruited from emergency departments
- **Intervention or exposure:** 12-week interactive text-message assessment and feedback intervention
- **Comparator or control:** SMS assessment-only and control arms
- **Duration or follow-up:** 12-week intervention with 3-, 6-, and 9-month follow-up
- **Endpoints:** binge drinking days, binge prevalence, drinks per drinking day, alcohol-related injury, retention
- **Effect estimates or direction:** At 9 months, assessment-plus-feedback had fewer binge drinking days, lower binge prevalence, fewer drinks per drinking day, and lower alcohol-related injury versus control; assessment-only did not show the same reduction.
- **Adverse events or safety notes:** Alcohol-related injury was an outcome with lower odds in the intervention group; no abstinence-challenge adverse-event evidence.
- **Limitations:** Young emergency-department sample, binge-reduction goal, and attrition; not an abstinence challenge.
- **Population mismatch:** Binge-drinking reduction intervention rather than temporary complete abstinence.
- **Directness to protocol:** adjacent digital alcohol-reduction comparator
- **Claim-use boundary:** context-only
- **Artifact candidates and rights status:** metadata/landing-page candidate only; rights status open_access; no PDF vendored
