---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1002-lim2.70029
slug: sources/cold-water-immersion/doi-10.1002-lim2.70029
title: An Exploratory Study Into the Effects of Regular Cold-Water Sea Swimming on Daily Indices of Mental Health
summary: Regular cold-water sea swimmers reported lower anxiety, higher self-confidence, and better next-morning sleep indices on swim days, but the naturalistic design does not isolate cold plunge effects.
status: draft
quality: usable
categories:
- cold-water-immersion
- cold-plunge
relations:
- type: parent_family
  target: experiment_family:cold-water-immersion
- type: related_protocol
  target: protocol_variant:cold-water-immersion/cold-plunge
source:
  kind: journal_article
  title: An Exploratory Study Into the Effects of Regular Cold-Water Sea Swimming on Daily Indices of Mental Health
  authors: Forsten RD; Wetherell MA
  year: 2025
  journal: Lifestyle Medicine
  doi: 10.1002/lim2.70029
  url: https://doi.org/10.1002/lim2.70029
  citation: Forsten RD; Wetherell MA. An Exploratory Study Into the Effects of Regular Cold-Water Sea Swimming on Daily Indices of Mental Health. Lifestyle Medicine. 2025. doi:10.1002/lim2.70029.
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1002/lim2.70029
    titleHash: c656ce3e10a4cef6de7527bffd4b394cb22721b5cbba1ee787af01a74fb82b7f
    url: https://doi.org/10.1002/lim2.70029
  canonicalUrl: https://doi.org/10.1002/lim2.70029
  identityAliases:
  - DOI 10.1002/lim2.70029
  - An Exploratory Study Into the Effects of Regular Cold-Water Sea Swimming on Daily Indices of Mental Health
researchEvidence:
  designKind: prospective_cohort
  designLabel: Exploratory naturalistic daily-diary study of regular cold-water sea swimmers
  populationLabel: Healthy regular female cold-water sea swimmers in the United Kingdom
  durationLabel: Repeated daily diary assessments on swim and non-swim days
  cohortKey: cohort:doi-10-1002-lim2-70029
  participantCount: 13
  participantCountKind: reported
  aggregateRole: primary
  notes:
  - 'Cold Plunge extraction context: bucket=Sleep, HRV, and recovery context; directness=adjacent_variant; claimUse=context-only; priority=medium'
sourceFindings:
- findingId: finding:doi-10.1002-lim2.70029:daily-diary-mental-health
  sourceKey: source_artifact:doi-10.1002-lim2.70029
  extractedFromArtifactId: art_doi_10_1002_lim2_70029
  findingKind: context
  population: Healthy regular female cold-water sea swimmers
  exposure: Naturally occurring cold-water sea swimming
  outcome: Anxiety, self-confidence, daily wellness, and sleep quality
  summary: The daily-diary study reported lower anxiety, higher self-confidence, and improved next-morning sleep-related ratings on swim days versus non-swim days, but this remains naturalistic sea-swimming context.
  evidenceUse:
  - adjacent_variant
  - context
- findingId: finding:doi-10.1002-lim2.70029:naturalistic-boundary
  sourceKey: source_artifact:doi-10.1002-lim2.70029
  extractedFromArtifactId: art_doi_10_1002_lim2_70029
  findingKind: context
  population: Regular sea swimmers
  exposure: Cold-water sea swimming plus exercise, outdoor setting, and routine context
  outcome: Directness to cold plunge
  summary: Because the exposure was not randomized and combined multiple non-cold factors, the source should not be used as direct causal evidence for a tub-based cold plunge.
  evidenceUse:
  - context
coldPlungeExtraction:
  batchId: batch-007
  evidenceBucket: Sleep, HRV, and recovery context
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  artifactRightsStatusGuess: open_access
  identityResolutionStatus: new_source
aliases:
- DOI 10.1002/lim2.70029
- An Exploratory Study Into the Effects of Regular Cold-Water Sea Swimming on Daily Indices of Mental Health
- 10.1002/lim2.70029
---

This source is included for **Sleep, HRV, and recovery context**.

**Findings:** The daily-diary study reported lower anxiety, higher self-confidence, and improved next-morning sleep-related ratings on swim days versus non-swim days, but this remains naturalistic sea-swimming context.; Because the exposure was not randomized and combined multiple non-cold factors, the source should not be used as direct causal evidence for a tub-based cold plunge.

**Why it matters:** Adds real-world cold-water exposure context for mood and sleep signals while keeping sea swimming, expectancy, exercise, and social context separated from a tub-based cold plunge.

**Potential experiment signals:** self_report:anxiety, self_report:mood, self_report:sleep_quality, self_report:confidence.

**Protocol takeaway:** Use as adjacent observational context only; do not promote it as direct evidence that a cold plunge improves sleep or anxiety.

**Claim use:** `context-only`.
