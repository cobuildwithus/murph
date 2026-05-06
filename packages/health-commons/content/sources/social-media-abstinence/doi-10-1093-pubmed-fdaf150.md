---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10-1093-pubmed-fdaf150"
slug: "sources/social-media-abstinence/doi-10-1093-pubmed-fdaf150"
title: "How do social media use, gaming frequency, and internalizing symptoms predict each other over time in early-to-middle adolescence?"
summary: "Use this source only as observational confounder/context evidence: in a large UK adolescent longitudinal cohort using RI-CLPM, social media time did not predict later internalizing symptoms over annual lags, and active/passive sensitivity analyses largely replicated this. Do not use it to claim that 24-hour, 72-hour, or 7-day social media fasts are effective, ineffective, safe, or burdensome, because no abstinence intervention was tested."
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
    pmid: "41530096"
    doi: "10.1093/pubmed/fdaf150"
    pmcid: "PMC13017292"
source: 
  kind: "review"
  title: "How do social media use, gaming frequency, and internalizing symptoms predict each other over time in early-to-middle adolescence?"
  year: 2026
  doi: "10.1093/pubmed/fdaf150"
  pmid: "41530096"
  url: "https://pubmed.ncbi.nlm.nih.gov/41530096/"
  citation: "How do social media use, gaming frequency, and internalizing symptoms predict each other over time in early-to-middle adolescence?. 2026."
researchEvidence: 
  designKind: "systematic_review"
  aggregateRole: "context"
  durationLabel: "2026"
  notes: 
    - "Imported from the Social Media Fast staged research package; preserve source-level caveats and directness notes before using for protocol claims."
---
# How do social media use, gaming frequency, and internalizing symptoms predict each other over time in early-to-middle adolescence?

## Extracted Role

- Directness: 

```json
[
  "observational_context",
  "not_social_media_abstinence_or_fast",
  "adjacent_digital_exposure_context"
]
```
- Claim use: 

```json
[
  "confounder_context",
  "do_not_use_for_intervention_effectiveness_claim"
]
```
- Population: 

```json
{
  "description": "Early-to-middle adolescents in Greater Manchester, England, contributing at least one wave of data in the #BeeWell longitudinal cohort.",
  "sampleSize": 25629,
  "baselineAge": "Mean 12 years 7 months; SD 3.58 months",
  "gender": "51% girls; multigroup analyses reported for girls and boys",
  "diversityOrSocioeconomicNotes": "17% with special educational needs, 29% eligible for free school meals, and 34% from minoritized ethnic groups.",
  "setting": "School-linked longitudinal survey with linked administrative/school records for covariates."
}
```
- Intervention: 

```json
{
  "description": "No intervention. The study measured self-reported time spent on social media on a normal weekday during term time, estimated active versus passive social media use proportions among users, gaming frequency, and internalizing symptoms.",
  "protocolMatch": "none",
  "fastVariant": null,
  "adjacentDigitalComponents": [
    "self-reported social media use",
    "active social media use",
    "passive social media use",
    "gaming frequency"
  ]
}
```
- Comparator: 

```json
{
  "description": "No randomized or experimental comparator. The analysis used multigroup random-intercept cross-lagged panel models to separate between-person random-intercept associations from within-person longitudinal cross-lagged associations across annual waves, with covariate controls.",
  "covariates": [
    "ethnicity",
    "free school meal eligibility",
    "special educational needs",
    "age at first survey"
  ],
  "groups": [
    "girls",
    "boys"
  ]
}
```
- Duration: 

```json
{
  "observedPeriod": "Three annual waves: T1 autumn 2021, T2 autumn 2022, T3 autumn 2023",
  "lagStructure": "12-month lags",
  "protocolFastVariantsCovered": [],
  "notes": "Does not test 24-hour, 72-hour, or 7-day social media abstinence or fast variants."
}
```
- Effect direction: 

```json
{
  "forSocialMediaFastOutcomes": "not_applicable_no_fast_intervention",
  "forSocialMediaUsePredictingInternalizingSymptoms": "null_longitudinal_within_person",
  "forInternalizingSymptomsPredictingSocialMediaUse": "null_longitudinal_within_person",
  "forGamingPredictingInternalizingSymptoms": "null_longitudinal_within_person",
  "forBetweenPersonSocialMediaInternalizingAssociation": "positive_small_association",
  "overall": "mixed_contextual_observational; mainly null for social media/gaming predicting later internalizing symptoms"
}
```

## Claim-Safe Summary

Use this source only as observational confounder/context evidence: in a large UK adolescent longitudinal cohort using RI-CLPM, social media time did not predict later internalizing symptoms over annual lags, and active/passive sensitivity analyses largely replicated this. Do not use it to claim that 24-hour, 72-hour, or 7-day social media fasts are effective, ineffective, safe, or burdensome, because no abstinence intervention was tested.

## Safety Or Burden



```json
{
  "reportedSafetyEvents": "No intervention and no adverse-event monitoring reported.",
  "burdenSignals": [
    "Self-report survey burden only; no abstinence, withdrawal, compliance burden, or experimental restriction burden."
  ],
  "interpretiveSafetySignal": "The null longitudinal findings help prevent overclaiming that higher adolescent social media time itself is a major causal driver of later internalizing symptoms, but the source does not evaluate safety or burden of abstinence."
}
```

## Limitations



```json
[
  "Observational secondary analysis; not randomized and cannot directly estimate effects of a social media fast or abstinence intervention.",
  "Self-reported social media use and gaming frequency rather than objective device/app logs.",
  "Annual 12-month measurement lags may miss shorter-term reciprocal or same-day/hourly associations.",
  "Did not differentiate specific social media platforms or specific types of games.",
  "Time-based measures may overlook purpose of use, emotional response, interaction quality, social context, timing, motivations, and other mechanisms.",
  "Active/passive distinction remained broad and narrow in scope.",
  "UK Greater Manchester context may limit generalizability to other cultural or national settings.",
  "Administrative linked data, including sex and free school meal eligibility, will remain confidential; full linked dataset reproducibility may be limited."
]
```

## Rights



```json
{
  "accessStatus": "Open Access",
  "license": "Creative Commons Attribution License (CC BY 4.0)",
  "artifactNotes": [
    "Primary artifact reviewed as OUP HTML full text.",
    "PMC and PubMed records exist, with PMID 41530096 and PMCID PMC13017292, but direct NCBI pages were not usable in-browser due to an access challenge; metadata was cross-checked through search results and OUP source text.",
    "No PDF-specific extraction was required for this rerun.",
    "No supplementary tables were extracted; sensitivity-analysis details are summarized from the main-text description."
  ]
}
```
