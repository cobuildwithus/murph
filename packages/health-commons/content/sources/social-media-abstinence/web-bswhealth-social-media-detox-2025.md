---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:web-bswhealth-social-media-detox-2025"
slug: "sources/social-media-abstinence/web-bswhealth-social-media-detox-2025"
title: "Should you try a social media detox? It might be what your mental health needs"
summary: "Use this source only to document that a public health-system article frames a social media detox as a planned break and mentions flexible durations including 24 hours, a few days, a week, or longer. Do not use it to claim that a 24-hour, 72-hour, or 7-day social media fast causes improvements in sleep, anxiety, focus, mood, or relationships."
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
    titleHash: "fb6fad6db4a9d4c518cfcf0827a6b37aa79f40c0a0d8969808fbf70bdb75ee76"
  identityAliases: 
    - "source_artifact:web-bswhealth-social-media-detox-2025"
    - "Should you try a social media detox? It might be what your mental health needs"
source: 
  kind: "web_page"
  title: "Should you try a social media detox? It might be what your mental health needs"
  year: 2025
  citation: "Should you try a social media detox? It might be what your mental health needs. 2025."
researchEvidence: 
  designKind: "other"
  aggregateRole: "context"
  durationLabel: "2025"
  notes: 
    - "Imported from the Social Media Fast staged research package; preserve source-level caveats and directness notes before using for protocol claims."
---
# Should you try a social media detox? It might be what your mental health needs

## Extracted Role

- Directness: 

```json
[
  "external_protocol_claim",
  "direct_social_media_detox_context",
  "not_trial_evidence"
]
```
- Claim use: 

```json
[
  "external_context_only",
  "do_not_use_for_efficacy_claim",
  "do_not_use_for_causal_benefit_claim"
]
```
- Population: 

```json
{
  "describedPopulation": "General public readers who feel overwhelmed by social media feeds, news, notifications, comparison, or late-night scrolling.",
  "studyPopulation": null,
  "clinicalPopulation": null
}
```
- Intervention: 

```json
{
  "labelUsedBySource": "social media detox",
  "description": "A planned break from online social media platforms, with suggested tactics including setting a goal, telling others, temporarily removing apps, turning off notifications, scheduling limited social media time if full offline use is unrealistic, planning replacement activities, and being patient with slips.",
  "protocolScopeFit": "Partly within scope for social media abstinence/fast context, but mixed with notification changes, scheduled screen time, and general digital well-being guidance."
}
```
- Comparator: 

```json
{
  "type": "none",
  "description": "No formal comparator, control group, randomization, or outcome measurement."
}
```
- Duration: 

```json
{
  "reportedVariants": [
    "24 hours",
    "a few days",
    "a week",
    "a month"
  ],
  "protocolScopeRelevant": [
    "24-hour",
    "7-day"
  ],
  "protocolScopeAdjacent": [
    "72-hour as possible interpretation of 'a few days', but not explicitly stated as 72 hours"
  ],
  "testedDuration": null
}
```
- Effect direction: 

```json
{
  "overall": "claimed_positive_only",
  "evidenceGradeDirection": null,
  "positiveFindings": [
    "The article claims possible improvements in sleep, anxiety, focus, relationships, and mood."
  ],
  "mixedFindings": null,
  "negativeFindings": null,
  "reason": "Public-facing article with no original intervention data, comparator, or quantified outcomes."
}
```

## Claim-Safe Summary

Use this source only to document that a public health-system article frames a social media detox as a planned break and mentions flexible durations including 24 hours, a few days, a week, or longer. Do not use it to claim that a 24-hour, 72-hour, or 7-day social media fast causes improvements in sleep, anxiety, focus, mood, or relationships.

## Safety Or Burden



```json
[
  "Potential worry about missing something important is acknowledged indirectly through advice to start with a manageable timeframe or weekend.",
  "Adherence slips are normalized.",
  "The intervention may require telling friends and family so they do not worry about delayed responses.",
  "The page points readers toward mental health support or primary care for anxiety or difficulty detoxing.",
  "No adverse events or systematic burden data are reported."
]
```

## Limitations



```json
[
  "Not a trial, cohort study, systematic review of the intervention, or registry record.",
  "No formal social media abstinence protocol is tested.",
  "Benefit and timeline statements are not sufficient for causal claims.",
  "The suggested intervention mixes abstinence with notification control, app removal, scheduled use, and digital well-being practices.",
  "No stratified findings for 24-hour, 72-hour, or 7-day variants."
]
```

## Rights



```json
{
  "artifactUse": "Public webpage used for metadata and context extraction only.",
  "reuseBoundary": "Do not reproduce article text beyond short metadata-level references; use summarized claims only.",
  "linkedSources": "The page links out to other studies and surveys, but those linked sources are not extracted here as independent evidence."
}
```
