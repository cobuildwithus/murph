---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:sedera-lokuge-social-media-ban-sri-lanka-2020"
slug: "sources/social-media-abstinence/sedera-lokuge-social-media-ban-sri-lanka-2020"
title: "Addicts without Substance? Social Media Addiction when Facebook Shuts Down"
summary: "Use only as external context that involuntary, externally imposed social media and communication-app deprivation may be associated with psychological distress in an addiction-framed natural experiment. Do not use to infer benefits or harms of a voluntary 24-hour, 72-hour, or 7-day social media fast."
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
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers: 
    doi: "10.48550/arXiv.2010.10605"
source: 
  kind: "journal_article"
  title: "Addicts without Substance? Social Media Addiction when Facebook Shuts Down"
  year: 2020
  doi: "10.48550/arXiv.2010.10605"
  url: "https://doi.org/10.48550/arXiv.2010.10605"
  citation: "Addicts without Substance? Social Media Addiction when Facebook Shuts Down. 2020."
researchEvidence: 
  designKind: "other"
  aggregateRole: "context"
  durationLabel: "2020"
  notes: 
    - "Imported from the Social Media Fast staged research package; preserve source-level caveats and directness notes before using for protocol claims."
---
# Addicts without Substance? Social Media Addiction when Facebook Shuts Down

## Extracted Role

- Directness: 

```json
{
  "level": "adjacent_involuntary_social_media_deprivation_natural_experiment",
  "rationale": "The exposure was an externally imposed national social media and communication-app ban during civil unrest, not a voluntary self-directed social media fast."
}
```
- Claim use: external_context_only
- Population: 

```json
{
  "summary": "Social media users in Sri Lanka surveyed during and after a government-imposed social media and communication-app ban.",
  "sampleSize": {
    "study1DuringBan": 476,
    "study2AfterBan": 205
  },
  "setting": "Sri Lanka during March 2018 government ban",
  "clinicalStatus": "general social media users framed through social media addiction measures, not treatment-seeking clinical participants"
}
```
- Intervention: 

```json
{
  "summary": "Externally imposed national ban of social media and communication applications.",
  "blockedServicesExamples": [
    "Facebook",
    "Twitter",
    "Instagram",
    "WhatsApp",
    "Viber",
    "WeChat"
  ],
  "notIntervention": [
    "not voluntary abstinence",
    "not self-directed fasting",
    "not social media-only if communication apps are included",
    "not a Health Commons protocol intervention"
  ]
}
```
- Comparator: 

```json
{
  "summary": "Longitudinal comparison of survey data during the non-use period and after the ban was lifted; no randomized comparator and no pre-ban baseline.",
  "studyDesign": "two-survey longitudinal natural experiment/research-in-progress design"
}
```
- Duration: 

```json
{
  "interventionDuration": "14 days as reported by the authors",
  "specificDatesReported": "March 7 to March 18, 2018",
  "targetProtocolDurationsCovered": [],
  "adjacentDurationVariant": "14-day involuntary deprivation"
}
```
- Effect direction: 

```json
{
  "forSourcePopulation": "negative_safety_signal_for_involuntary_deprivation",
  "forTargetProtocol": "not_direct_may_not_generalize",
  "preserveAs": "burden_distress_signal"
}
```

## Claim-Safe Summary

Use only as external context that involuntary, externally imposed social media and communication-app deprivation may be associated with psychological distress in an addiction-framed natural experiment. Do not use to infer benefits or harms of a voluntary 24-hour, 72-hour, or 7-day social media fast.

## Safety Or Burden



```json
{
  "signals": [
    "Psychological distress associated with social media addiction during involuntary non-use.",
    "Withdrawal-like interpretation offered by authors.",
    "Government-imposed loss of access occurred during a politically and socially stressful context.",
    "Communication apps were blocked as well as social media, increasing practical burden and limiting applicability to voluntary social media-only fasting."
  ],
  "adverseEvents": "No formal adverse-event monitoring; distress measured through survey constructs."
}
```

## Limitations



```json
[
  "Conference short paper/research-in-progress and arXiv preprint record.",
  "Not voluntary abstinence.",
  "Government ban occurred during riots and racial tensions, creating major contextual confounding.",
  "No pre-lockdown baseline survey.",
  "Second survey sample was smaller than the first.",
  "Includes communication applications, not only social media platforms.",
  "Self-report survey design and addiction framing may not apply to nonproblematic users.",
  "The paper itself states it focused only on psychological distress in the transition between use and non-use."
]
```

## Rights



```json
{
  "license": "CC0 1.0 Universal as indicated by arXiv license link",
  "artifactStatus": "arXiv full-text PDF available; conference short paper",
  "reuseNotes": "Use only as adjacent safety/burden context for involuntary deprivation; note corrected arXiv identifier."
}
```
