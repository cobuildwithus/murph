---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:heart-org-time-restricted-eating-cvd-death-2024-03-18
slug: sources/time-restricted-eating/heart-org-time-restricted-eating-cvd-death-2024-03-18
title: 8-hour time-restricted eating linked to a 91% higher risk of cardiovascular death
summary: AHA news release describing preliminary observational research presented at EPI/Lifestyle 2024, reporting an association between eating all food within less than 8 hours per day and higher cardiovascular death risk. The release explicitly represents an association, not causal trial evidence.
status: draft
quality: usable
aliases:
- heart-org-time-restricted-eating-cvd-death-2024-03-18
categories:
- time-restricted-eating
relations:
- type: related_protocol
  target: protocol_variant:time-restricted-eating/time-restricted-eating-18-6
- type: parent_family
  target: experiment_family:time-restricted-eating
source:
  kind: web_page
  title: 8-hour time-restricted eating linked to a 91% higher risk of cardiovascular death
  authors: American Heart Association Newsroom
  year: 2024
  journal: American Heart Association Newsroom
  citation: American Heart Association Newsroom. 8-hour time-restricted eating linked to a 91% higher risk of cardiovascular death. Published 18 March 2024. https://newsroom.heart.org/news/8-hour-time-restricted-eating-linked-to-a-91-higher-risk-of-cardiovascular-death
  url: https://newsroom.heart.org/news/8-hour-time-restricted-eating-linked-to-a-91-higher-risk-of-cardiovascular-death
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://newsroom.heart.org/news/8-hour-time-restricted-eating-linked-to-a-91-higher-risk-of-cardiovascular-death
  canonicalUrl: https://newsroom.heart.org/news/8-hour-time-restricted-eating-linked-to-a-91-higher-risk-of-cardiovascular-death
researchEvidence:
  designKind: other
  designLabel: 'News release about preliminary observational conference research (upstream extraction label: preliminary_observational_news_release)'
  participantCount: 20000
  participantCountKind: approximate
  populationLabel: More than 20,000 U.S. adults in NHANES-linked observational analysis, as described in the news release
  durationLabel: Dietary-pattern reports linked to mortality follow-up; not an intervention duration
  aggregateRole: primary
  cohortKey: aha-news-2024-short-eating-window-cvd-death-observational
evidenceBucket: Guidelines and external safety context
whyItMatters: This is a public safety signal that should be kept separate from causal evidence and used to justify caution for high-risk users rather than to claim harm causality.
potentialMurphEndpoints:
- cardiovascular mortality association
- all-cause mortality association
- existing cardiovascular disease or cancer subgroup caution
- observational-not-causal boundary
protocolTakeaway: Use as external safety context only; do not infer that 18:6 causes cardiovascular death, but consider advising medical review for people with cardiovascular disease or cancer.
murphTakeaway: Include high-risk medical review language and keep observational AHA claims explicitly labeled preliminary and non-causal.
studyDesign: Preliminary observational-news context
modality: Eating duration less than 8 hours per day
claimUse: context-only
sourceFindings:
- findingId: finding:heart-org-time-restricted-eating-cvd-death-2024-03-18-preliminary-cvd-death-association
  sourceKey: source_artifact:heart-org-time-restricted-eating-cvd-death-2024-03-18
  extractedFromArtifactId: art-heart-org-time-restricted-eating-cvd-death-2024-03-18-heart-org-news-page
  findingKind: safety
  population: More than 20,000 U.S. adults in an observational analysis described by AHA
  exposure: Self-reported eating duration less than 8 hours per day
  outcome: Cardiovascular death association
  summary: The news release reports a preliminary association between eating within less than 8 hours per day and higher cardiovascular death risk, including a 91% higher risk versus a 12- to 16-hour eating duration reference.
  evidenceUse:
  - safety
  - context
- findingId: finding:heart-org-time-restricted-eating-cvd-death-2024-03-18-observational-noncausal-boundary
  sourceKey: source_artifact:heart-org-time-restricted-eating-cvd-death-2024-03-18
  extractedFromArtifactId: art-heart-org-time-restricted-eating-cvd-death-2024-03-18-heart-org-news-page
  findingKind: context
  population: General public audience
  exposure: AHA news release about conference research
  outcome: Causal-inference boundary
  summary: The source is a news release about observational preliminary research; it should not be used to claim causality or direct protocol efficacy.
  evidenceUse:
  - context
  - safety
murphV1Priority: Low
pdfRightsStatus: open_access
---
This source is included for **Guidelines and external safety context**.

**Findings:** The news release reports a preliminary association between eating within less than 8 hours per day and higher cardiovascular death risk, including a 91% higher risk versus a 12- to 16-hour eating duration reference. The source is a news release about observational preliminary research; it should not be used to claim causality or direct protocol efficacy.

**Why it matters:** This is a public safety signal that should be kept separate from causal evidence and used to justify caution for high-risk users rather than to claim harm causality.

**Potential experiment signals:** cardiovascular mortality association, all-cause mortality association, existing cardiovascular disease or cancer subgroup caution, observational-not-causal boundary.

**Protocol takeaway:** Use as external safety context only; do not infer that 18:6 causes cardiovascular death, but consider advising medical review for people with cardiovascular disease or cancer.

**Claim use:** `context-only`.
