---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1093-ageing-afae022
slug: sources/post-meal-walking/doi-10.1093-ageing-afae022
title: 'Prevalence of postprandial hypotension in older adults: a systematic review and meta-analysis'
summary: A 2024 meta-analysis found postprandial hypotension to be common in older adults, supporting fall/dizziness screening before encouraging immediate post-meal walking in frail or symptomatic users.
status: draft
quality: usable
aliases:
- doi:10.1093/ageing/afae022
- PMCID:PMC10898335
categories:
- post-meal-walking
relations:
-
  type: related_protocol
  target: protocol_variant:post-meal-walking/walking-after-every-meal
-
  type: parent_family
  target: experiment_family:post-meal-walking
source:
  kind: review
  title: 'Prevalence of postprandial hypotension in older adults: a systematic review and meta-analysis'
  authors: Lei Huang; Sheyu Li; Xiaofeng Xie; Xiaoli Huang; Lily Dongxia Xiao; Ying Zou; Wenyi Jiang; Fengying Zhang
  year: 2024
  journal: Age and Ageing
  citation: 'Huang L; Li S; Xie X; Huang X; Xiao LD; Zou Y; Jiang W; Zhang F. Prevalence of postprandial hypotension in older adults: a systematic review and meta-analysis. Age and Ageing. 2024. doi:10.1093/ageing/afae022.'
  doi: 10.1093/ageing/afae022
  url: https://pmc.ncbi.nlm.nih.gov/articles/PMC10898335/
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    pmcid: PMC10898335
    doi: 10.1093/ageing/afae022
    url: https://pmc.ncbi.nlm.nih.gov/articles/PMC10898335/
  canonicalUrl: https://pmc.ncbi.nlm.nih.gov/articles/PMC10898335/
  identityAliases:
  - doi:10.1093/ageing/afae022
  - PMCID:PMC10898335
researchEvidence:
  designKind: meta_analysis
  designLabel: Systematic review and meta-analysis of PPH prevalence
  participantCount: 3021
  participantCountKind: reported
  includedStudyCount: 13
  populationLabel: Older adults from community, long-term healthcare, and geriatric department settings.
  durationLabel: Postprandial blood-pressure monitoring periods varied by included study, generally within the first 2 hours after eating.
  aggregateRole: synthesis
  cohortKey: cohort:doi-10.1093-ageing-afae022
  notes:
  - Safety-boundary evidence
  - High heterogeneity across studies
  - Prevalence evidence only
evidenceBucket: safety-older-pregnancy-pediatric-hypotension
whyItMatters: Quantifies how large the older-adult postprandial hypotension boundary may be, especially in frail or care-facility settings.
potentialMurphEndpoints:
- post-meal systolic blood pressure drop
- dizziness or syncope after meals
- falls near post-meal walking window
protocolTakeaway: Older adults, especially frail or residential-care users, should screen for post-meal dizziness, low blood pressure, or falls before treating immediate post-meal walking as routine.
murphTakeaway: Useful for sizing and wording the PPH/falls safety boundary; it is not protocol efficacy evidence.
studyDesign: meta_analysis
modality: postprandial blood pressure prevalence synthesis
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **safety-older-pregnancy-pediatric-hypotension**.

**Findings:** The meta-analysis pooled 13 studies and estimated that postprandial hypotension affects a substantial share of older adults, with higher prevalence in clinical geriatric settings and major heterogeneity across diagnostic methods.

**Why it matters:** Quantifies how large the older-adult postprandial hypotension boundary may be, especially in frail or care-facility settings.

**Potential experiment signals:** post-meal systolic blood pressure drop, dizziness or syncope after meals, falls near post-meal walking window.

**Protocol takeaway:** Older adults, especially frail or residential-care users, should screen for post-meal dizziness, low blood pressure, or falls before treating immediate post-meal walking as routine.

**Claim use:** `safety-only`.

## Extraction details

- **Population:** Older adults across community, residential/long-term care, and geriatric department settings.
- **Participant count:** 3,021 participants across 13 eligible studies.
- **Intervention/exposure:** Postprandial blood-pressure monitoring/diagnosis of postprandial hypotension.
- **Comparator/control:** Prevalence subgroups by care setting and diagnostic procedures.
- **Duration/follow-up:** Varied post-meal blood-pressure monitoring windows across included studies, usually up to 2 hours after eating.
- **Endpoints:** post-meal systolic blood pressure drop, dizziness or syncope after meals, falls near post-meal walking window
- **Effect estimates or direction:** Pooled prevalence of PPH was 40.5% (95% CI 29.0% to 51.9%), with higher estimates in geriatrics departments than in community samples.
- **Adverse events/safety notes:** PPH is linked in the review context to falls, syncope, cardiovascular events, stroke, and mortality risk in older adults.
- **Limitations:** High heterogeneity; Diagnostic and measurement procedures varied; Prevalence synthesis, not a walking intervention
- **Population mismatch:** Safety-boundary evidence rather than routine adult/general wellness protocol evidence.
- **Directness to Walking After Every Meal:** safety_boundary
- **Artifact candidates and rights:** Rights status in the canonical ledger or extracted source metadata is `open_access`. Keep source-page metadata and external identifiers; do not add copyrighted publisher PDFs to Git unless redistribution rights are independently confirmed.

## Atomic finding links

- `finding:walking-after-every-meal:doi-10.1093-ageing-afae022:001`
- `finding:walking-after-every-meal:doi-10.1093-ageing-afae022:002`
