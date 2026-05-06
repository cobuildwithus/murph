---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10-1001-jamapediatrics-2022-1519"
slug: "sources/social-media-abstinence/doi-10-1001-jamapediatrics-2022-1519"
title: "Effects of Limiting Recreational Screen Media Use on Physical Activity and Sleep in Families With Children: A Cluster Randomized Clinical Trial"
summary: "Use only as adjacent evidence that broad household screen-media reduction increased children's physical activity but did not significantly improve main objective sleep outcomes. Do not use as direct evidence for Social Media Fast effects."
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
    pmid: "35604678"
    doi: "10.1001/jamapediatrics.2022.1519"
    pmcid: "PMC9127712"
source: 
  kind: "journal_article"
  title: "Effects of Limiting Recreational Screen Media Use on Physical Activity and Sleep in Families With Children: A Cluster Randomized Clinical Trial"
  year: 2022
  doi: "10.1001/jamapediatrics.2022.1519"
  pmid: "35604678"
  url: "https://pubmed.ncbi.nlm.nih.gov/35604678/"
  citation: "Effects of Limiting Recreational Screen Media Use on Physical Activity and Sleep in Families With Children: A Cluster Randomized Clinical Trial. 2022."
researchEvidence: 
  designKind: "other"
  aggregateRole: "context"
  durationLabel: "2022"
  notes: 
    - "Imported from the Social Media Fast staged research package; preserve source-level caveats and directness notes before using for protocol claims."
---
# Effects of Limiting Recreational Screen Media Use on Physical Activity and Sleep in Families With Children: A Cluster Randomized Clinical Trial

## Extracted Role

- Directness: 

```json
[
  "adjacent_screen_time",
  "generic_recreational_screen_media_not_social_media_specific"
]
```
- Claim use: 

```json
[
  "external_context_only"
]
```
- Population: Population-based sample of Danish families from 10 municipalities; 89 families randomized, including 181 children and 164 adults. Children in groups had mean ages about 8.6 and 9.5 years.
- Intervention: Household recreational screen media reduction for 2 weeks. Families assigned to intervention limited recreational screen use to 3 hours or less per week per person, handed over portable devices such as smartphones/tablets where possible, used a basic phone for calls/texts, and recorded screen use.
- Comparator: Usual recreational screen media use; control families were instructed to carry on as usual.
- Duration: 

```json
{
  "observed": "2-week intervention and follow-up",
  "protocolVariantMatch": [],
  "notes": "Not 24-hour, 72-hour, or 7-day; not social media-specific."
}
```
- Effect direction: 

```json
{
  "overall": "positive_for_child_physical_activity_null_for_main_sleep_outcomes",
  "physicalActivity": "positive_children_not_adults",
  "sleep": "null_main_EEG_sleep_outcomes",
  "nextDayEnergy": "not_measured_or_not_identified",
  "claimBoundary": "adjacent_only"
}
```

## Claim-Safe Summary

Use only as adjacent evidence that broad household screen-media reduction increased children's physical activity but did not significantly improve main objective sleep outcomes. Do not use as direct evidence for Social Media Fast effects.

## Safety Or Burden



```json
[
  "Burden included handing over portable devices for 2 weeks, limiting recreational screen use to 3 hours/week, using a simple phone for calls/texts, and keeping diaries.",
  "Some adults could not hand over smartphones because of job requirements; at least one adult per intervention family had to relinquish a smartphone.",
  "High compliance was reported, but device surrender is a stronger and less generalizable intervention than a self-directed social media fast.",
  "No adverse-event signal was extracted."
]
```

## Limitations



```json
[
  "Generic recreational screen media intervention; social media use was not isolated.",
  "Family/child-focused population, not adult individual protocol.",
  "Two-week duration does not match 24-hour, 72-hour, or 7-day variants.",
  "Primary endpoint was physical activity, not sleep quality or mood.",
  "No significant main sleep effects; should not be cited as evidence that social media fasting improves sleep.",
  "Device handover and household cluster design may not generalize to voluntary social media-only abstinence."
]
```

## Rights

DOI article available via JAMA and indexed with PMID 35604678 and PMCID PMC9127712. Use only as adjacent screen-time context and preserve the null main sleep findings.
