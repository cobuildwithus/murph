---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10-1371-journal-pone-0272416"
slug: "sources/social-media-abstinence/doi-10-1371-journal-pone-0272416"
title: "Effects of restricting social media usage on wellbeing and performance: A randomized control trial among students"
summary: "Use as adjacent evidence that partial platform restriction can reduce targeted use while producing substitution to instant messaging and no detectable well-being or academic-performance effect. Do not use as evidence for abstinence, 24-hour fasts, 72-hour fasts, or 7-day Social Media Fast outcomes."
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
    pmid: "36001541"
    doi: "10.1371/journal.pone.0272416"
    pmcid: "PMC9401146"
source: 
  kind: "journal_article"
  title: "Effects of restricting social media usage on wellbeing and performance: A randomized control trial among students"
  year: 2022
  doi: "10.1371/journal.pone.0272416"
  pmid: "36001541"
  url: "https://pubmed.ncbi.nlm.nih.gov/36001541/"
  citation: "Effects of restricting social media usage on wellbeing and performance: A randomized control trial among students. 2022."
researchEvidence: 
  designKind: "other"
  aggregateRole: "context"
  durationLabel: "2022"
  notes: 
    - "Imported from the Social Media Fast staged research package; preserve source-level caveats and directness notes before using for protocol claims."
---
# Effects of restricting social media usage on wellbeing and performance: A randomized control trial among students

## Extracted Role

- Directness: 

```json
[
  "adjacent_screen_time",
  "platform_restriction_not_abstinence",
  "controlled_trial"
]
```
- Claim use: 

```json
[
  "confounder_context",
  "substitution_context",
  "do_not_use_for_abstinence_claim"
]
```
- Population: 

```json
{
  "description": "Students in the faculty of economics and business at a large European university.",
  "sampleSize": {
    "firstSurveyCompleted": 191,
    "survey2Completed": 157,
    "survey3Completed": 144,
    "finalSurveyCompleted": 121
  },
  "notes": [
    "Participants installed tracking software on personal computers and mobile devices.",
    "iOS tracking was not supported by the software, limiting mobile measurement accuracy for iOS users."
  ]
}
```
- Intervention: 

```json
{
  "description": "Treatment group was instructed and incentivized to restrict Facebook, Instagram, and Snapchat to a maximum of 10 minutes per day across devices during the treatment block.",
  "implementation": [
    "Software notified students when they reached the 10-minute limit and then automatically blocked the targeted services.",
    "Students could disable the blocking feature if they needed longer use.",
    "The authors did not fully block the services because complete loss of access might have negative effects if students needed social media for study-related information exchange."
  ],
  "protocolFit": "adjacent partial restriction; not abstinence or fast"
}
```
- Comparator: 

```json
{
  "description": "Control group without specific instructions during the same block.",
  "protocolComparatorFit": "usual use control"
}
```
- Duration: 

```json
{
  "studyObservation": "Three academic terms/quarters across most of an academic year.",
  "baseline": "Block 1 from mid-November to end of January.",
  "intervention": "Block 2 from February to mid-April; described as the treatment block and approximately 2.5 months.",
  "postTreatment": "Block 3 from mid-April to end of June.",
  "protocolDurationVariants": {
    "24Hour": "not studied",
    "72Hour": "not studied",
    "7Day": "not studied"
  }
}
```
- Effect direction: 

```json
{
  "overall": "null_for_wellbeing_and_performance_with_successful_targeted_use_reduction",
  "targetedUse": "reduced",
  "wellbeing": "null",
  "academicPerformance": "null",
  "totalDigitalTime": "null_or_not_reduced",
  "substitution": "increased_instant_messaging"
}
```

## Claim-Safe Summary

Use as adjacent evidence that partial platform restriction can reduce targeted use while producing substitution to instant messaging and no detectable well-being or academic-performance effect. Do not use as evidence for abstinence, 24-hour fasts, 72-hour fasts, or 7-day Social Media Fast outcomes.

## Safety Or Burden



```json
[
  "Substitution to instant messaging is a major confounding and burden signal.",
  "Total digital-device time did not decrease, limiting interpretation of platform restriction as a general digital reduction.",
  "The authors avoided full blocking because complete lack of access could be negative if social media was used to exchange important study information.",
  "The study involved extensive activity tracking and GDPR-related privacy constraints; raw data were not publicly shared."
]
```

## Limitations



```json
[
  "Restriction rather than abstinence.",
  "Only Facebook, Instagram, and Snapchat were targeted.",
  "Participants could disable the blocking feature.",
  "Long treatment block differs from 24-hour, 72-hour, and 7-day fast variants.",
  "Student sample from one faculty at a large European university.",
  "Tracking software did not support iOS, affecting accuracy for iOS users.",
  "Attrition occurred across surveys.",
  "Substitution to instant messaging complicates causal interpretation for social media fasting."
]
```

## Rights



```json
[
  "PLOS ONE open access article distributed under Creative Commons Attribution License.",
  "Raw data are not public because of GDPR and IRB restrictions; minimal replication data are available through OSF.",
  "Use as adjacent substitution/confounding evidence, not as direct Social Media Fast evidence."
]
```
