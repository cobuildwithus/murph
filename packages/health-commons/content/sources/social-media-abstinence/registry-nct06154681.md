---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:registry-nct06154681"
slug: "sources/social-media-abstinence/registry-nct06154681"
title: "Effectiveness of a World Digital Detox Program for Enhancing Youth and Family Well-being: A Multicenter Randomized Controlled Trial"
summary: "This registry record documents a completed youth-and-family digital detox randomized trial with 4-week outcome assessment, but no effect estimates were extracted. It is useful for tracking adjacent registered trials and population boundaries, not for claims about social media fast effectiveness."
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
    titleHash: "950a6c1781a9c7d9cb6e6c1c2342fe0e68054f5646aa10d856fb9fc3a141276a"
  identityAliases: 
    - "source_artifact:registry-nct06154681"
    - "Effectiveness of a World Digital Detox Program for Enhancing Youth and Family Well-being: A Multicenter Randomized Controlled Trial"
source: 
  kind: "other"
  title: "Effectiveness of a World Digital Detox Program for Enhancing Youth and Family Well-being: A Multicenter Randomized Controlled Trial"
  year: 2023
  citation: "Effectiveness of a World Digital Detox Program for Enhancing Youth and Family Well-being: A Multicenter Randomized Controlled Trial. 2023."
researchEvidence: 
  designKind: "other"
  aggregateRole: "context"
  durationLabel: "2023"
  notes: 
    - "Imported from the Social Media Fast staged research package; preserve source-level caveats and directness notes before using for protocol claims."
---
# Effectiveness of a World Digital Detox Program for Enhancing Youth and Family Well-being: A Multicenter Randomized Controlled Trial

## Extracted Role

- Directness: 

```json
[
  "adjacent_screen_time",
  "digital_detox",
  "youth_family_program",
  "not_social_media_fast_effectiveness_result"
]
```
- Claim use: 

```json
[
  "population_boundary",
  "registered_trial_context",
  "do_not_use_for_effectiveness_claim"
]
```
- Population: 

```json
{
  "description": "Adolescents aged 10-14 years and their primary caregivers.",
  "sampleSize": 168,
  "age": "Adolescents 10-14 years; caregivers 18 years or older.",
  "sexGender": null,
  "clinicalStatus": "Family and adolescent well-being context; healthy volunteers accepted; not limited to problematic social media use.",
  "setting": "Multicenter randomized trial registry record; family-based digital detox program."
}
```
- Intervention: 

```json
{
  "name": "World Digital Detox Program",
  "description": "Family-oriented digital detox intervention intended to curb digital device exposure, including smartphones and social media, and enhance youth and family well-being.",
  "components": [
    "Youth and family well-being focus",
    "Screen exposure reduction",
    "Smartphone and social media use reduction or dependency focus"
  ],
  "protocolFit": "Adjacent only: broader youth/family digital detox and screen exposure program, not a clearly specified self-directed social media abstinence fast."
}
```
- Comparator: 

```json
{
  "description": "Randomized parallel comparator or control arm described in the registry structure; detailed comparator activities were not extractable from accessible registry/mirror material in this rerun.",
  "type": "registry comparator arm"
}
```
- Duration: 

```json
{
  "interventionExposure": null,
  "followUp": "Baseline to 4 weeks post intervention for listed outcomes.",
  "protocolVariants": [],
  "notes": "Exact intervention dose and abstinence duration were not extractable; not assignable to 24-hour, 72-hour, or 7-day fast variants."
}
```
- Effect direction: 

```json
{
  "socialMediaFastSpecific": "not_applicable",
  "digitalDetoxProgram": "no_effect_estimate_extracted",
  "stress": "no_result_extracted",
  "wellBeing": "no_result_extracted",
  "familyOutcomes": "no_result_extracted",
  "safety": "no_safety_result_extracted"
}
```

## Claim-Safe Summary

This registry record documents a completed youth-and-family digital detox randomized trial with 4-week outcome assessment, but no effect estimates were extracted. It is useful for tracking adjacent registered trials and population boundaries, not for claims about social media fast effectiveness.

## Safety Or Burden



```json
[
  "Youth and caregiver participation may impose family-level burden.",
  "Exclusion criteria included serious medical conditions requiring frequent hospitalization, special educational needs, and substance abuse, limiting safety generalizability.",
  "No adverse-event results were extracted from accessible registry material."
]
```

## Limitations



```json
[
  "Registry record rather than peer-reviewed outcome report.",
  "No extracted results or effect estimates.",
  "Digital detox program is broader than social media abstinence.",
  "Youth and family intervention context does not match self-directed adult or general wellness fasts.",
  "Exact intervention dose, comparator activities, and abstinence duration were not extractable from accessible registry material."
]
```

## Rights



```json
{
  "availability": "Public ClinicalTrials.gov registry record.",
  "artifactUse": "Use for registered-trial landscape and boundary tracking only; do not use for effectiveness claims without posted or published results."
}
```
