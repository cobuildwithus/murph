---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:registry-nct04550286"
slug: "sources/social-media-abstinence/registry-nct04550286"
title: "Study Smart! Effectiveness of a Smartphone Use Intervention on Students' Performance and Well-being"
summary: "Use as boundary evidence that broad smartphone-reduction/planning interventions can measure social media app time and may show null direct effects. Do not use as evidence that a social media abstinence fast improves health outcomes."
status: "draft"
quality: "usable"
categories: 
  - "social-media-abstinence"
  - "social-media-fast"
relations: 
  - type: "parent_family"
    target: "experiment_family:social-media-abstinence"
  - type: "related_protocol"
    target: "protocol_variant:social-media-abstinence/social-media-fast"
sourceIdentity: 
  identityKind: "other"
  canonicalIdBasis: "title_hash"
  identifiers: 
    titleHash: "c05a82d7eb99816bdc1cedf4b6aa0ef8d0d706da7c0f07718a96fd091f2dc7dd"
  identityAliases: 
    - "source_artifact:registry-nct04550286"
    - "Study Smart! Effectiveness of a Smartphone Use Intervention on Students' Performance and Well-being"
source: 
  kind: "other"
  title: "Study Smart! Effectiveness of a Smartphone Use Intervention on Students' Performance and Well-being"
  year: 2020
  citation: "Study Smart! Effectiveness of a Smartphone Use Intervention on Students' Performance and Well-being. 2020."
researchEvidence: 
  designKind: "other"
  aggregateRole: "context"
  durationLabel: "2020"
  notes: 
    - "Imported from the Social Media Fast staged research package; preserve source-level caveats and directness notes before using for protocol claims."
---
# Study Smart! Effectiveness of a Smartphone Use Intervention on Students' Performance and Well-being

## Extracted Role

- Directness: 

```json
[
  "adjacent_smartphone_abstinence",
  "adjacent_smartphone_reduction_not_social_media_fast",
  "confounder_context"
]
```
- Claim use: 

```json
[
  "confounder_context"
]
```
- Population: University students in Germany, age at least 16 years, regular Android smartphone users, with at least one graded exam; associated analysis N=787, mean age 22.81 years, 72.3% women.
- Intervention: Planning intervention during exam preparation. Participants received written instructions and generated up to three action plans and three coping plans to reduce smartphone usage time, including switching the smartphone off or placing it out of sight/reach while studying; objective smartphone and social-media app usage were logged by a screen-time app.
- Comparator: Control condition received general study-environment advice plus an unrelated dietary-habits survey to balance time/attention, without smartphone-use reduction planning.
- Duration: 

```json
{
  "observed": "Objective app-measured smartphone and social media usage across 21 days after baseline; self-report follow-ups at 7 and 14 days, with additional later assessments after exams.",
  "protocolVariantMatch": [],
  "notes": "Not a 24-hour, 72-hour, or 7-day abstinence fast; it is a smartphone-use planning/reduction intervention."
}
```
- Effect direction: 

```json
{
  "overall": "null_direct_effect_mixed_mechanistic",
  "smartphoneUse": "no_significant_direct_reduction",
  "socialMediaUse": "no_significant_direct_reduction",
  "selfEfficacy": "positive_mechanistic_signal",
  "claimBoundary": "adjacent_only_not_social_media_abstinence"
}
```

## Claim-Safe Summary

Use as boundary evidence that broad smartphone-reduction/planning interventions can measure social media app time and may show null direct effects. Do not use as evidence that a social media abstinence fast improves health outcomes.

## Safety Or Burden



```json
[
  "No trial adverse-event findings identified in the registry candidate.",
  "Participant burden included installing a monitoring app, completing online questionnaires, and generating action/coping plans.",
  "Associated publication notes digital-detox literature can include craving or separation anxiety, but those are contextual literature signals rather than trial outcome findings for this source.",
  "App-measured behavioral data were incomplete for some participants, which is a burden/adherence signal."
]
```

## Limitations



```json
[
  "Smartphone intervention; social media was not isolated as the intervention target.",
  "Planning/reduction intervention rather than full abstinence.",
  "German university student and Android-user sample; not general adult population.",
  "Exam-preparation context may confound productivity/stress outcomes.",
  "Associated publication results should not be promoted as direct evidence for social media fasts."
]
```

## Rights

ClinicalTrials.gov public registry record; associated Computers in Human Behavior article is publisher-listed open access under CC BY. Use only as adjacent/confounder context distinguishing smartphone-use interventions from Social Media Fast evidence.
