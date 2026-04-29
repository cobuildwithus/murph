---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1093-eurjpc-zwag079
slug: sources/post-meal-walking/doi-10.1093-eurjpc-zwag079
title: 'Optimizing physical activity bouts to interrupt sedentary behaviour for cardiometabolic health: a systematic review and meta-analyses of randomized controlled trials'
summary: Large systematic review and meta-analyses of randomized trials on optimizing physical-activity bouts to interrupt sedentary behavior for cardiometabolic outcomes.
status: draft
quality: usable
aliases:
- doi:10.1093/eurjpc/zwag079
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
  title: 'Optimizing physical activity bouts to interrupt sedentary behaviour for cardiometabolic health: a systematic review and meta-analyses of randomized controlled trials'
  authors: Jen Vanherle; Gregor H. L. M. Franssen; Anna Ivanova; Bert O. Eijnde; Wouter M. A. Franssen
  year: 2026
  journal: European Journal of Preventive Cardiology
  citation: 'Vanherle J, Franssen GHLM, Ivanova A, Eijnde BO, Franssen WMA. Optimizing physical activity bouts to interrupt sedentary behaviour for cardiometabolic health: a systematic review and meta-analyses of randomized controlled trials. Eur J Prev Cardiol. 2026. doi:10.1093/eurjpc/zwag079.'
  doi: 10.1093/eurjpc/zwag079
  url: https://academic.oup.com/eurjpc/advance-article/doi/10.1093/eurjpc/zwag079/8571395
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1093/eurjpc/zwag079
    url: https://academic.oup.com/eurjpc/advance-article/doi/10.1093/eurjpc/zwag079/8571395
  canonicalUrl: https://academic.oup.com/eurjpc/advance-article/doi/10.1093/eurjpc/zwag079/8571395
  identityAliases:
  - doi:10.1093/eurjpc/zwag079
researchEvidence:
  designKind: meta_analysis
  designLabel: Systematic review and meta-analyses of randomized sedentary-behavior interruption trials
  participantCount: 2216
  participantCountKind: reported
  includedStudyCount: 144
  populationLabel: Adults aged 18-65 years with or without cardiometabolic conditions in randomized trials of sedentary-behavior interruption.
  durationLabel: Randomized sedentary-behavior interruption trials; literature searched through February 2025.
  aggregateRole: synthesis
  cohortKey: cohort:doi-10.1093-eurjpc-zwag079
  notes:
  - 144 studies
  - 247 intervention arms
  - 2216 participants
  - Broad sedentary-behavior interruption scope
evidenceBucket: reviews-meta-analyses-mechanisms
whyItMatters: It is a very recent broad dose-context review for activity breaks, but it is broader than meal-timed walking.
potentialMurphEndpoints:
- Blood glucose
- Insulin
- Triglycerides
- Blood pressure
- Flow-mediated dilation
protocolTakeaway: Frequent activity bouts can improve cardiometabolic markers in sedentary-interruption trials, but the source is adjacent to post-meal walking and should stay context-only.
murphTakeaway: Useful for future dose/bout optimization questions and for separating frequent bouts from one after-meal rule.
studyDesign: meta_analysis
modality: physical activity bouts interrupting sedentary behavior
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---
This source is included for **reviews-meta-analyses-mechanisms**.

**Findings:** Large systematic review and meta-analyses of randomized trials on optimizing physical-activity bouts to interrupt sedentary behavior for cardiometabolic outcomes.

**Why it matters:** It is a very recent broad dose-context review for activity breaks, but it is broader than meal-timed walking.

**Potential experiment signals:** Blood glucose; Insulin; Triglycerides; Blood pressure; Flow-mediated dilation.

**Protocol takeaway:** Frequent activity bouts can improve cardiometabolic markers in sedentary-interruption trials, but the source is adjacent to post-meal walking and should stay context-only.

**Claim use:** `context-only`.

## Extraction details

- **Population:** Adults aged 18-65 years with or without cardiometabolic conditions in randomized trials of sedentary-behavior interruption.
- **Participant count:** 2216
- **Participant count kind:** `reported_total_across_included_trials`
- **Intervention/exposure:** Physical-activity bouts interrupting sedentary behavior, varying by frequency, intensity, and duration.
- **Comparator/control:** Sedentary control or alternative bout characteristics in randomized trials.
- **Duration/follow-up:** Randomized sedentary-behavior interruption trials; literature searched through February 2025.
- **Endpoints:** Blood glucose; Insulin; Triglycerides; Blood pressure; Flow-mediated dilation
- **Effect estimates or direction:** Frequent physical-activity bouts reduced blood glucose (SMD=-0.22, 95% CI -0.27 to -0.16) and insulin (SMD=-0.26, 95% CI -0.32 to -0.19); longer/intense bouts lowered triglycerides (SMD=-0.27, 95% CI -0.34 to -0.19).
- **Adverse events/safety notes:** No adverse-event rate was extracted.
- **Limitations:** Broad sedentary-behavior interruption scope; Not meal-timed; Published after canonical batch as newest broad context; Protocol characteristics heterogeneous
- **Population mismatch:** Broad sedentary-interruption trials in adults, not meal-specific walking after every meal.
- **Directness to Walking After Every Meal:** `same_mechanism`.
- **Artifact candidates and rights:** Rights status in the canonical ledger is `open_access`. Keep source-page metadata and external identifiers; do not add copyrighted publisher PDFs to Git unless redistribution rights are independently confirmed.

## Atomic finding links

- `finding:walking-after-every-meal:doi-10.1093-eurjpc-zwag079:001`
- `finding:walking-after-every-meal:doi-10.1093-eurjpc-zwag079:002`
