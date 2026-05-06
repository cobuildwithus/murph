---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:registry-nct06143852"
slug: "sources/social-media-abstinence/registry-nct06143852"
title: "Comparing Change in Social Media Use and Well-being Among College Students Receiving a One-week Exercise or Mindfulness Intervention"
summary: "Use as adjacent measurement and protocol context for a one-week social media reduction plus exercise replacement trial in college students; do not use as evidence that social media abstinence or a social media fast improves outcomes."
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
    titleHash: "2dc73355b50ba27543a85351603b9234105760910508adc3bc990108e7b68c76"
  identityAliases: 
    - "source_artifact:registry-nct06143852"
    - "Comparing Change in Social Media Use and Well-being Among College Students Receiving a One-week Exercise or Mindfulness Intervention"
source: 
  kind: "other"
  title: "Comparing Change in Social Media Use and Well-being Among College Students Receiving a One-week Exercise or Mindfulness Intervention"
  year: 2023
  citation: "Comparing Change in Social Media Use and Well-being Among College Students Receiving a One-week Exercise or Mindfulness Intervention. 2023."
researchEvidence: 
  designKind: "other"
  aggregateRole: "context"
  durationLabel: "2023"
  notes: 
    - "Imported from the Social Media Fast staged research package; preserve source-level caveats and directness notes before using for protocol claims."
---
# Comparing Change in Social Media Use and Well-being Among College Students Receiving a One-week Exercise or Mindfulness Intervention

## Extracted Role

- Directness: 

```json
[
  "adjacent_social_media_reduction",
  "not_social_media_abstinence_fast"
]
```
- Claim use: 

```json
[
  "measurement_context",
  "protocol_context",
  "do_not_use_for_abstinence_effect_claim"
]
```
- Population: 

```json
{
  "description": "Johns Hopkins University students, age 18 years or older, all genders, healthy volunteers accepted, with daily social media use greater than 1 hour and ownership of an iPhone or Android smartphone.",
  "inclusionSignals": [
    "Johns Hopkins University student",
    "age 18 years or older",
    "frequent daily social media use greater than 1 hour",
    "willing to share smartphone-use screenshots including pickups, notifications, and average screen time",
    "exercising 1 hour or less daily on average"
  ],
  "exclusionSignals": [
    "younger than 18",
    "not a Johns Hopkins University student",
    "does not own a smartphone",
    "uses smartphone less than 1 hour daily",
    "exercises more than 1 hour daily"
  ]
}
```
- Intervention: 

```json
{
  "description": "Three-arm trial: no-intervention control, daily mindfulness meditation, or social media reduction plus exercise replacement.",
  "socialMediaSpecificComponent": "Participants in the social media reduction plus exercise arm reduce social media use by at least 30 minutes daily for one week and replace that time with at least 30 minutes of physical exercise.",
  "otherActiveComponent": "Daily approximately 12-minute gratitude-focused mindfulness meditations through Calm for one week.",
  "abstinence": false
}
```
- Comparator: 

```json
{
  "description": "Control arm with instructions to use social media as usual; mindfulness arm can function as an active comparator for the social media reduction plus exercise arm.",
  "noInterventionControl": true
}
```
- Duration: 

```json
{
  "intervention": "1 week",
  "followUp": "immediately post-intervention and up to 1 week after the intervention",
  "durationVariantMatch": [
    "7-day duration only as reduction/replacement, not abstinence"
  ]
}
```
- Effect direction: not_applicable_registered_protocol_no_extracted_results

## Claim-Safe Summary

Use as adjacent measurement and protocol context for a one-week social media reduction plus exercise replacement trial in college students; do not use as evidence that social media abstinence or a social media fast improves outcomes.

## Safety Or Burden



```json
[
  "Requires daily intervention activities for one week.",
  "Requires sharing smartphone-use screenshots, creating measurement and privacy burden.",
  "Exercise replacement is participant-chosen; activities with high injury potential are discouraged."
]
```

## Limitations



```json
[
  "Not an abstinence intervention.",
  "Social media reduction is bundled with exercise replacement, so any effects would not isolate abstinence or social media non-use.",
  "University-student sample from one institution.",
  "Very short follow-up of up to one week post-intervention.",
  "Registry/protocol source, not a peer-reviewed outcomes paper for claims of effectiveness."
]
```

## Rights



```json
[
  "ClinicalTrials.gov registry record is publicly accessible.",
  "Third-party mirrors may contain transformed or summarized registry text; use the official registry URL as the primary artifact when possible.",
  "No full-text copyright artifact needed for outcome claims because this extraction uses registry design information."
]
```
