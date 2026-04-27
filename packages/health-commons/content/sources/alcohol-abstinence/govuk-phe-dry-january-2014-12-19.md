---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:govuk-phe-dry-january-2014-12-19
slug: sources/alcohol-abstinence/govuk-phe-dry-january-2014-12-19
title: PHE encourages people to sign up to Dry January
summary: Public Health England webpage encouraging Dry January sign-up while framing the campaign for social drinkers rather than medical detox.
status: draft
quality: usable
aliases:
- PHE encourages people to sign up to Dry January
- Public Health England 2014
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
  kind: web_page
  title: PHE encourages people to sign up to Dry January
  authors: Public Health England
  year: 2014
  journal: GOV.UK
  citation: Public Health England. PHE encourages people to sign up to Dry January. GOV.UK 2014.
  url: https://www.gov.uk/government/news/phe-encourages-people-to-sign-up-to-dry-january
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 59854b8f795bdbb10a18d29cbab90de944d670c4e2306ca4c594d9c3423f4a4e
    url: https://www.gov.uk/government/news/phe-encourages-people-to-sign-up-to-dry-january
  canonicalUrl: https://www.gov.uk/government/news/phe-encourages-people-to-sign-up-to-dry-january
  identityAliases:
  - PHE encourages people to sign up to Dry January
  - Public Health England 2014
researchEvidence:
  designKind: other
  designLabel: Public-health campaign announcement
  populationLabel: People considering Dry January, especially social drinkers
  durationLabel: Dry January campaign sign-up period
  aggregateRole: context
  cohortKey: govuk-phe-2014-dry-january
  notes:
  - source-index.json was absent in the supplied snapshot; identity resolution used the canonical source ledger and fallback content inventory.
  - Unknown or non-person corpus counts were not entered as participantCount to preserve Health Commons contract validity.
evidenceBucket: Dry January and temporary abstinence campaign evidence
whyItMatters: Provides an official safety boundary for who the public campaign is intended to serve.
potentialMurphEndpoints:
- public-health framing
- safety boundary
- social drinkers
protocolTakeaway: Protocol safety copy should warn that alcohol-dependent users or people at withdrawal risk need medical advice rather than unsupervised abstinence.
murphTakeaway: Protocol safety copy should warn that alcohol-dependent users or people at withdrawal risk need medical advice rather than unsupervised abstinence.
studyDesign: Government public-health webpage
modality: Public Health England Dry January sign-up encouragement
claimUse: safety-only
directness: adjacent_variant
participantCountNote: Participant count not extracted or not applicable.
endpoints:
- public-health framing
- safety boundary
- social drinkers
effectEstimatesOrDirection: The PHE source frames Dry January as intended for social drinkers and not as a medical detox programme, supporting a safety boundary for dependent or withdrawal-risk users.
adverseEventsOrSafetyNotes: 'Implied safety boundary: Dry January is not a detox programme for dependent drinkers.'
limitations: Public announcement, not a research study.
populationMismatch: Government campaign source, not participant outcomes.
claimUseBoundary: Safety/context only.
sourceFindings:
-
  findingId: finding:alcohol-abstinence/batch-002/govuk-phe-dry-january-2014-12-19/social-drinker-safety-boundary
  sourceKey: source_artifact:govuk-phe-dry-january-2014-12-19
  extractedFromArtifactId: art_govuk-phe-dry-january-2014-12-19_external
  findingKind: safety
  population: People considering Dry January
  exposure: Public-health Dry January sign-up campaign
  outcome: Appropriate audience and safety boundary
  summary: The PHE source frames Dry January as intended for social drinkers and not as a medical detox programme, supporting a safety boundary for dependent or withdrawal-risk users.
  evidenceUse:
  - safety
murphV1Priority: Medium
pdfRightsStatus: unknown
---


This source is included for **Dry January and temporary abstinence campaign evidence**.

**Findings:**
- The PHE source frames Dry January as intended for social drinkers and not as a medical detox programme, supporting a safety boundary for dependent or withdrawal-risk users.

**Why it matters:** Provides an official safety boundary for who the public campaign is intended to serve.

**Potential experiment signals:**
- public-health framing
- safety boundary
- social drinkers

**Protocol takeaway:** Protocol safety copy should warn that alcohol-dependent users or people at withdrawal risk need medical advice rather than unsupervised abstinence.

**Claim use:** `safety-only`.
