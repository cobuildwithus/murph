---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:registry-nct07429357"
slug: "sources/social-media-abstinence/registry-nct07429357"
title: "The REWIRE Behaviour Study"
summary: "Use only as adjacent future-trial and measurement context for a 12-week adolescent social media reduction program; do not use for any claim that a short social media fast or abstinence intervention is effective."
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
    titleHash: "c21dd0198eb73d9e6dcc6972ad0718a008a18f6c469af58b08449feafe2624ce"
  identityAliases: 
    - "source_artifact:registry-nct07429357"
    - "The REWIRE Behaviour Study"
source: 
  kind: "other"
  title: "The REWIRE Behaviour Study"
  year: 2026
  citation: "The REWIRE Behaviour Study. 2026."
researchEvidence: 
  designKind: "other"
  aggregateRole: "context"
  durationLabel: "2026"
  notes: 
    - "Imported from the Social Media Fast staged research package; preserve source-level caveats and directness notes before using for protocol claims."
---
# The REWIRE Behaviour Study

## Extracted Role

- Directness: 

```json
[
  "adjacent_social_media_reduction",
  "clinical_or_subclinical_youth_population",
  "not_social_media_abstinence_fast"
]
```
- Claim use: 

```json
[
  "measurement_context",
  "population_boundary",
  "future_trial_context",
  "do_not_use_for_effect_claim"
]
```
- Population: 

```json
{
  "description": "Youth aged 12 to 17 years with symptoms of anxiety or depression who use social media for more than 3 hours per day and have a caregiver able and willing to participate.",
  "inclusionSignals": [
    "age 12 to 17 years",
    "owns a smartphone",
    "social media use greater than 3 hours per day",
    "experiencing anxiety or depression symptoms",
    "caregiver participation required",
    "ability to communicate in English"
  ],
  "healthyVolunteers": false
}
```
- Intervention: 

```json
{
  "description": "Two-phase program with a pilot feasibility phase followed by a balanced parallel-group randomized controlled trial. The active REWIRE arm is a structured, manualized, family-based behavioral program.",
  "socialMediaSpecificComponent": "Reduce social media use to 50% of each participant's baseline level using 7-day objective smartphone usage data.",
  "additionalComponents": [
    "weekly youth and caregiver group sessions",
    "individualized goal-setting and progress-review sessions",
    "reinforcement of individualized non-screen alternative behaviors",
    "stimulus control such as disabling notifications or device-free bedroom rules",
    "contingency management",
    "behavioral contracting",
    "parental modeling and structured support",
    "problem-solving and barrier identification",
    "daily screenshots and ecological momentary assessment"
  ],
  "abstinence": false
}
```
- Comparator: 

```json
{
  "description": "Attention-matched psychoeducation control about social media, screen time, lifestyle behaviors, and mental health, without behavioral modification strategies, reduction targets, or reinforcement protocols.",
  "activeComparator": true
}
```
- Duration: 

```json
{
  "baseline": "1 week",
  "interventionOrControl": "12 weeks",
  "totalParticipation": "13 weeks",
  "durationVariantMatch": []
}
```
- Effect direction: no_results_not_yet_recruiting

## Claim-Safe Summary

Use only as adjacent future-trial and measurement context for a 12-week adolescent social media reduction program; do not use for any claim that a short social media fast or abstinence intervention is effective.

## Safety Or Burden



```json
[
  "Adolescent mental health population with anxiety or depression symptoms.",
  "Caregiver participation required.",
  "Weekly in-person group sessions plus individualized sessions.",
  "Daily smartphone screenshots and EMA surveys.",
  "Accelerometer wear requirements.",
  "Brain imaging and neurocognitive assessment burden.",
  "Includes suicidal ideation as an assessed endpoint, indicating need to treat as higher-sensitivity clinical context."
]
```

## Limitations



```json
[
  "No outcome data available.",
  "Not an abstinence or short fast protocol.",
  "Long 12-week family-based behavioral program, not a 24-hour, 72-hour, or 7-day social media fast.",
  "Population is minors with emotional distress and heavy social media use.",
  "Extensive clinical/research monitoring limits generalizability to self-directed social media fasting."
]
```

## Rights



```json
[
  "ClinicalTrials.gov record is publicly accessible.",
  "Third-party trial mirrors may summarize or transform registry content; use official registry as primary artifact.",
  "No outcomes or published effect data should be inferred from the registry design."
]
```
