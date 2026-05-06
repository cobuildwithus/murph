---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10-1371-journal-pone-0059087"
slug: "sources/social-media-abstinence/doi-10-1371-journal-pone-0059087"
title: "Association Between Facebook Dependence and Poor Sleep Quality: A Study in a Sample of Undergraduate Students in Peru"
summary: "Use this source only as background that problematic or dependent Facebook use can confound sleep outcomes in undergraduate samples. Do not use it as evidence that social media fasting improves sleep."
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
  canonicalIdBasis: "pmid"
  identifiers: 
    pmid: "23554978"
    doi: "10.1371/journal.pone.0059087"
    pmcid: "PMC3595202"
source: 
  kind: "journal_article"
  title: "Association Between Facebook Dependence and Poor Sleep Quality: A Study in a Sample of Undergraduate Students in Peru"
  doi: "10.1371/journal.pone.0059087"
  pmid: "23554978"
  url: "https://pubmed.ncbi.nlm.nih.gov/23554978/"
  citation: "Association Between Facebook Dependence and Poor Sleep Quality: A Study in a Sample of Undergraduate Students in Peru"
researchEvidence: 
  designKind: "other"
  aggregateRole: "context"
  notes: 
    - "Imported from the Social Media Fast staged research package; preserve source-level caveats and directness notes before using for protocol claims."
---
# Association Between Facebook Dependence and Poor Sleep Quality: A Study in a Sample of Undergraduate Students in Peru

## Extracted Role

- Directness: 

```json
[
  "observational_context",
  "platform_specific_facebook_dependence",
  "sleep_confounder_context",
  "no_intervention"
]
```
- Claim use: 

```json
[
  "confounder_context",
  "background_sleep_context",
  "do_not_use_for_social_media_fast_effect_claim"
]
```
- Population: 

```json
{
  "description": "Undergraduate students at Universidad Peruana de Ciencias Aplicadas, Lima, Peru.",
  "sampleSize": 418,
  "age": {
    "mean": 20.1,
    "sd": 2.5
  },
  "sexOrGender": {
    "women": 322,
    "womenPercent": 77
  },
  "setting": "Private university, School of Psychology within Health Sciences"
}
```
- Intervention: 

```json
{
  "description": "No intervention. Exposure was Facebook dependence measured by an Internet Addiction Questionnaire adapted to Facebook.",
  "socialMediaSpecific": true,
  "abstinenceOrFast": false
}
```
- Comparator: 

```json
{
  "description": "Students classified as Facebook dependent versus not Facebook dependent; adjusted prevalence ratio models controlled for age, sex, and years in faculty.",
  "randomizedComparator": false
}
```
- Duration: 

```json
{
  "protocolVariantMatch": [],
  "assignedDuration": null,
  "durationNotes": "No abstinence or fast duration; cross-sectional exposure and sleep-quality measurement."
}
```
- Effect direction: 

```json
{
  "summary": "observational_negative_sleep_association",
  "details": "Facebook dependence was associated with higher prevalence of poor sleep quality, but no abstinence intervention was tested."
}
```

## Claim-Safe Summary

Use this source only as background that problematic or dependent Facebook use can confound sleep outcomes in undergraduate samples. Do not use it as evidence that social media fasting improves sleep.

## Safety Or Burden



```json
[
  "No intervention safety data.",
  "Background burden signal: Facebook dependence was associated with poor sleep quality and daytime dysfunction."
]
```

## Limitations



```json
[
  "Cross-sectional design cannot establish causality.",
  "Facebook dependence scale was adapted from an Internet addiction questionnaire and was not specific to Facebook addiction.",
  "The Facebook dependence and sleep-quality scales were not validated in Peru.",
  "Study focused only on Facebook, not other social networks or gaming sites.",
  "Other potential confounders such as social support and socioeconomic status were not included.",
  "Older platform-specific study from 2013 may not reflect current social media patterns."
]
```

## Rights



```json
{
  "artifactStatus": "usable",
  "accessNotes": "PLOS full-text article usable; DOI resolver initially failed but publisher page was accessible.",
  "license": "Creative Commons Attribution License",
  "rightsCaution": "Open-access article; extraction is summary-level."
}
```
