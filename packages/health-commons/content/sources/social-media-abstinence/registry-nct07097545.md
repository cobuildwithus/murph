---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:registry-nct07097545"
slug: "sources/social-media-abstinence/registry-nct07097545"
title: "Change in Social Media Use and Well-being Among College Students Receiving a Two-week Exercise or Mindfulness Intervention"
summary: "Use only to note an ongoing registered two-week college-student trial of social media reduction plus exercise and mindfulness comparators. Do not use for claims about efficacy, safety, or abstinence/fast outcomes."
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
    titleHash: "713c7f903c7019a3993368824117ff530c046976f3b72cb15253a0f9eaeaa3a6"
  identityAliases: 
    - "source_artifact:registry-nct07097545"
    - "Change in Social Media Use and Well-being Among College Students Receiving a Two-week Exercise or Mindfulness Intervention"
source: 
  kind: "other"
  title: "Change in Social Media Use and Well-being Among College Students Receiving a Two-week Exercise or Mindfulness Intervention"
  year: 2025
  citation: "Change in Social Media Use and Well-being Among College Students Receiving a Two-week Exercise or Mindfulness Intervention. 2025."
researchEvidence: 
  designKind: "other"
  aggregateRole: "context"
  durationLabel: "2025"
  notes: 
    - "Imported from the Social Media Fast staged research package; preserve source-level caveats and directness notes before using for protocol claims."
---
# Change in Social Media Use and Well-being Among College Students Receiving a Two-week Exercise or Mindfulness Intervention

## Extracted Role

- Directness: 

```json
[
  "adjacent_screen_time",
  "registered_trial_no_results",
  "reduction_not_abstinence"
]
```
- Claim use: 

```json
[
  "population_boundary",
  "registered_trials_context",
  "do_not_use_for_effect_claim"
]
```
- Population: 

```json
{
  "description": "Johns Hopkins University students, age 18 or older, with frequent daily social media use greater than 1 hour and smartphone ownership.",
  "plannedEnrollment": 300,
  "sex": "all",
  "healthyVolunteers": true,
  "inclusionNotes": [
    "Must enable and share smartphone-use metric screenshots.",
    "Must exercise 1 hour or less daily on average."
  ]
}
```
- Intervention: 

```json
{
  "arms": [
    {
      "name": "Control",
      "type": "no_intervention",
      "description": "Use social media as usual."
    },
    {
      "name": "Mindfulness",
      "type": "behavioral_mindfulness",
      "description": "Approximately 15-minute Calm mindfulness-style meditations daily for two weeks, including gratitude and stress-management content."
    },
    {
      "name": "Social Media Reduction + Exercise",
      "type": "behavioral_social_media_reduction_plus_exercise",
      "description": "Reduce social media use by at least 30 minutes daily for two weeks and replace that time with at least 30 minutes daily exercise chosen by the participant."
    }
  ],
  "protocolFit": "adjacent reduction-and-substitution intervention, not abstinence or fast"
}
```
- Comparator: 

```json
{
  "description": "No-intervention usual social media use control; mindfulness arm also functions as an active non-reduction comparison.",
  "protocolComparatorFit": "adjacent"
}
```
- Duration: 

```json
{
  "interventionLength": "2 weeks",
  "assessmentTimepoints": [
    "baseline",
    "immediately after intervention",
    "one week after intervention period, three weeks from baseline"
  ],
  "protocolDurationVariants": {
    "24Hour": "not studied",
    "72Hour": "not studied",
    "7Day": "not studied; related one-week predecessor trial exists separately but is not this source"
  }
}
```
- Effect direction: 

```json
{
  "overall": "not_applicable_no_results",
  "reason": "Registered trial record without posted outcomes."
}
```

## Claim-Safe Summary

Use only to note an ongoing registered two-week college-student trial of social media reduction plus exercise and mindfulness comparators. Do not use for claims about efficacy, safety, or abstinence/fast outcomes.

## Safety Or Burden



```json
[
  "Exercise substitution is dissuaded from activities with high potential for injury.",
  "The protocol requires participants to share smartphone screenshots, which is a privacy and participation-burden issue.",
  "No adverse-event findings are posted."
]
```

## Limitations



```json
[
  "No results available.",
  "Registered trial record rather than completed peer-reviewed outcome report.",
  "Intervention combines social media reduction with exercise replacement, making active ingredients confounded.",
  "Mindfulness arm is not a social media fast.",
  "College-student sample at a single university limits population generalizability."
]
```

## Rights



```json
[
  "ClinicalTrials.gov registry data are public registry information.",
  "Accessible extraction used ClinicalTrials.gov-linked registry mirrors because the direct ClinicalTrials.gov page rendered limited text.",
  "Use only for registry and population-boundary context; do not infer outcomes."
]
```
