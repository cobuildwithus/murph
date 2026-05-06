---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:registry-nct06353451"
slug: "sources/social-media-abstinence/registry-nct06353451"
title: "Digital Detox Study: A Randomized Controlled Trial"
summary: "Use as adjacent measurement, adherence, and burden context for a 3-week smartphone screen-time reduction protocol that includes a social media limit; do not use this registry/protocol source as evidence for 24-hour, 72-hour, or 7-day social media abstinence effects."
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
    titleHash: "8d7272ad69ee235e071845cd2b2c53c5069a27ce4820d33780d38f3c9e6a7ab3"
  identityAliases: 
    - "source_artifact:registry-nct06353451"
    - "Digital Detox Study: A Randomized Controlled Trial"
source: 
  kind: "other"
  title: "Digital Detox Study: A Randomized Controlled Trial"
  year: 2024
  citation: "Digital Detox Study: A Randomized Controlled Trial. 2024."
researchEvidence: 
  designKind: "other"
  aggregateRole: "context"
  durationLabel: "2024"
  notes: 
    - "Imported from the Social Media Fast staged research package; preserve source-level caveats and directness notes before using for protocol claims."
---
# Digital Detox Study: A Randomized Controlled Trial

## Extracted Role

- Directness: 

```json
[
  "adjacent_screen_time",
  "adjacent_social_media_reduction",
  "not_social_media_abstinence_fast"
]
```
- Claim use: 

```json
[
  "measurement_context",
  "burden_context",
  "do_not_use_for_social_media_abstinence_effect_claim"
]
```
- Population: 

```json
{
  "description": "Healthy Austrian students or young adults aged 18 to 29 years who own a smartphone and use it at least 3 hours per day, without diagnosed or treated mental disorder, ongoing psychotherapy, or psychopharmacological treatment.",
  "inclusionSignals": [
    "18 to 29 years old",
    "healthy volunteer/student population",
    "smartphone ownership",
    "at least 3 hours daily smartphone screen time",
    "primarily social media use noted in protocol context"
  ],
  "exclusionSignals": [
    "diagnosed mental disorder",
    "ongoing psychotherapy",
    "psychotropic drugs",
    "daily screen time less than 3 hours"
  ]
}
```
- Intervention: 

```json
{
  "description": "Participants in the intervention group continue usual smartphone behavior during a baseline period, then limit smartphone screen time to less than or equal to 2 hours per day for 3 weeks.",
  "socialMediaSpecificComponent": "Protocol artifact also describes reducing social media use to less than 1 hour per day during the 3-week intervention.",
  "monitoring": [
    "ESMira app",
    "weekly screenshot uploads of smartphone screen time",
    "fitness tracker for movement and sleep or physiological measures"
  ],
  "abstinence": false
}
```
- Comparator: 

```json
{
  "description": "Control group continues usual smartphone and social media behavior through follow-up; control participants may be offered the intervention after follow-up.",
  "usualUseControl": true
}
```
- Duration: 

```json
{
  "baseline": "10 days",
  "intervention": "3 weeks",
  "followUp": "approximately 6 weeks post-intervention in the full study timeline",
  "durationVariantMatch": []
}
```
- Effect direction: not_applicable_registered_protocol_no_effect_claim_from_registry

## Claim-Safe Summary

Use as adjacent measurement, adherence, and burden context for a 3-week smartphone screen-time reduction protocol that includes a social media limit; do not use this registry/protocol source as evidence for 24-hour, 72-hour, or 7-day social media abstinence effects.

## Safety Or Burden



```json
[
  "Possible discomfort, burdensome feelings, withdrawal symptoms, or unrest during the 3-week reduction period.",
  "Participants are given an emergency phone number for psychological support if symptoms are too stressful.",
  "Requires app-based participation, weekly screen-time screenshot uploads, and wearing a fitness tracker.",
  "Potential privacy and adherence burden from usage screenshots and longitudinal monitoring."
]
```

## Limitations



```json
[
  "Intervention is smartphone screen-time reduction, not social media abstinence.",
  "Protocol-described social media limit is bundled with overall smartphone time limits.",
  "Healthy 18-29 Austrian student sample may not generalize to broader adult or adolescent populations.",
  "Open-label behavioral intervention.",
  "Registry/protocol source should not be used alone for effectiveness claims."
]
```

## Rights



```json
[
  "ClinicalTrials.gov record and ClinicalTrials.gov-hosted protocol/SAP artifact are publicly accessible registry materials.",
  "Protocol PDF includes copyright/template language and should be summarized, not reproduced.",
  "A peer-reviewed results article for this trial exists separately and should be extracted as a separate source if used for effectiveness claims."
]
```
