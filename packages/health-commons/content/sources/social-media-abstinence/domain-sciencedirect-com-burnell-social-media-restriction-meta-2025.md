---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:domain-sciencedirect-com-burnell-social-media-restriction-meta-2025"
slug: "sources/social-media-abstinence/domain-sciencedirect-com-burnell-social-media-restriction-meta-2025"
title: "The effects of social media restriction: Meta-analytic evidence from randomized controlled trials"
summary: "Use this source only as adjacent measurement/effect context: a 2025 meta-analysis of 32 randomized controlled trial articles found that social media restriction or abstinence instructions for discrete periods produced small, statistically significant improvements in subjective well-being among college/adult samples. Do not use it as direct evidence that a 24-hour, 72-hour, or 7-day Social Media Fast is effective, safe, or recommended."
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
  - type: same_work_as
    target: source_artifact:doi-10-1016-j-ssmmh-2025-100459
sourceIdentity: 
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers: 
    doi: "10.1016/j.ssmmh.2025.100459"
source: 
  kind: "journal_article"
  title: "The effects of social media restriction: Meta-analytic evidence from randomized controlled trials"
  year: 2025
  doi: "10.1016/j.ssmmh.2025.100459"
  url: "https://doi.org/10.1016/j.ssmmh.2025.100459"
  citation: "The effects of social media restriction: Meta-analytic evidence from randomized controlled trials. 2025."
researchEvidence: 
  designKind: "other"
  aggregateRole: "context"
  durationLabel: "2025"
  notes: 
    - "Imported from the Social Media Fast staged research package; preserve source-level caveats and directness notes before using for protocol claims."
---
# The effects of social media restriction: Meta-analytic evidence from randomized controlled trials

## Extracted Role

- Directness: 

```json
{
  "level": "adjacent",
  "tags": [
    "secondary_evidence",
    "restriction_or_abstinence",
    "not_protocol_duration_specific",
    "not_full_abstinence_only"
  ],
  "rationale": "This source synthesizes randomized trials that instructed participants to limit or entirely abstain from social media for discrete periods. It is adjacent to the Social Media Fast protocol because it combines reduction and abstinence variants and does not isolate 24-hour, 72-hour, or 7-day fast effects in the accessible extraction text."
}
```
- Claim use: 

```json
[
  "measurement_context",
  "adjacent_effect_context"
]
```
- Population: 

```json
{
  "summary": "Thirty-two articles, 5544 individuals, and 91 effect sizes were included.",
  "age": "All included studies used college student or adult samples; reported mean age was 23.38 years.",
  "sexOrGender": "Samples skewed female, approximately 70%.",
  "clinicalStatus": "Not limited to clinical populations in the accessible extraction text.",
  "protocolApplicability": "Best aligned with young adult/adult social media users; weaker applicability to adolescents, children, or protocol users seeking only full abstinence fasts."
}
```
- Intervention: 

```json
{
  "summary": "Social media restriction interventions, including instructions to limit use or entirely abstain from social media for a discrete period.",
  "protocolMapping": "Adjacent digital/social media intervention evidence. Includes abstinence-like interventions but pools them with restriction/reduction interventions.",
  "notableScopeBoundary": "Do not treat the pooled intervention as equivalent to a full social media fast unless a primary included trial separately matches the fast definition."
}
```
- Comparator: 

```json
{
  "summary": "Across included randomized controlled trials, comparators were control or usual-use/no-restriction conditions as implemented in the original studies.",
  "detailLimit": "Comparator details varied by included trial and were not fully extractable from the accessible source text."
}
```
- Duration: 

```json
{
  "summary": "Included interventions occurred over discrete periods, but exact duration distribution was not fully extractable from the accessible source text.",
  "moderatorFinding": "Length of intervention was examined as a study characteristic; moderation by length of intervention was not consistent, and accessible snippets reported no moderation by type or length of intervention.",
  "protocolDurationMapping": {
    "24_hour": "not separately extractable from this meta-analysis record",
    "72_hour": "not separately extractable from this meta-analysis record",
    "7_day": "not separately extractable as an isolated pooled estimate from this meta-analysis record"
  },
  "durationClaimSafety": "Use only for the existence of variable discrete intervention lengths and for the caution that duration-specific effects were not clearly separable for protocol variants."
}
```
- Effect direction: 

```json
{
  "overall": "small_benefit",
  "subjectiveWellbeing": "small statistically significant improvement",
  "positiveIndicators": "small statistically significant improvement",
  "negativeIndicators": "small statistically significant improvement",
  "heterogeneity": "heterogeneous_or_variable_by_outcome",
  "durationSpecificDirection": "not_safe_to_extract_for_24h_72h_or_7d_protocol_variants"
}
```

## Claim-Safe Summary

Use this source only as adjacent measurement/effect context: a 2025 meta-analysis of 32 randomized controlled trial articles found that social media restriction or abstinence instructions for discrete periods produced small, statistically significant improvements in subjective well-being among college/adult samples. Do not use it as direct evidence that a 24-hour, 72-hour, or 7-day Social Media Fast is effective, safe, or recommended.

## Safety Or Burden



```json
{
  "summary": "No direct safety, adverse-event, adherence burden, or withdrawal-burden result was extractable from the accessible source text.",
  "burdenSignal": "The intervention category itself includes restrictive or abstinence instructions, which may impose user burden, but this meta-analysis record should not be used to quantify burden.",
  "claimSafety": "Do not use this source to claim that social media fasting is safe, unsafe, easy, acceptable, or low burden."
}
```

## Limitations



```json
[
  "Secondary meta-analysis rather than a primary Social Media Fast trial.",
  "Combines interventions that limited social media use with interventions that entirely abstained from social media use.",
  "Does not isolate protocol-scoped 24-hour, 72-hour, or 7-day fast variants in the accessible extraction text.",
  "All included studies used college student or adult samples; mean age was 23.38 and samples were approximately 70% female.",
  "Pooled effects were small and heterogeneous.",
  "Moderation by study characteristics, including length and type of intervention, was not consistent.",
  "Endpoint scope focused on subjective well-being outcomes, not clinical diagnosis, objective functioning, or long-term safety.",
  "Accessible ScienceDirect text did not provide full duration distribution, adherence details, or adverse-event reporting."
]
```

## Rights



```json
{
  "access": "Open access",
  "license": "CC BY 4.0",
  "publisher": "Elsevier Ltd.",
  "artifactUse": "Metadata, abstract-level findings, and short tabular snippets can be used with attribution under the license. Verify full tables and duration distribution against the publisher article or article PDF before reproducing detailed table content.",
  "citationRequired": true
}
```
