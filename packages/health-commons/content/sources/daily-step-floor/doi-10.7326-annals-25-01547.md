---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.7326-annals-25-01547
slug: sources/daily-step-floor/doi-10.7326-annals-25-01547
title: Step Accumulation Patterns and Risk for Cardiovascular Events and Mortality Among Suboptimally Active Adults
summary: Prospective cohort evidence suggests that among adults taking fewer than 8000 steps/day, accumulating steps in longer bouts was associated with lower mortality and cardiovascular event risk, but the finding is observational and context-only for a step-floor protocol.
status: draft
quality: usable
aliases:
- del Pozo Cruz B et al. 2025 Step Accumulation Patterns and Risk for Cardiovascular Events and Mortality Among Suboptimally Active Adults
- doi-10.7326-annals-25-01547
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: journal_article
  title: Step Accumulation Patterns and Risk for Cardiovascular Events and Mortality Among Suboptimally Active Adults
  authors: del Pozo Cruz B, Ahmadi M, Sabag A, Saint Maurice PF, Lee IM, Stamatakis E
  year: 2025
  journal: Annals of Internal Medicine
  pmid: '41144973'
  doi: 10.7326/annals-25-01547
  url: https://www.acpjournals.org/doi/10.7326/ANNALS-25-01547
  citation: del Pozo Cruz B, Ahmadi M, Sabag A, Saint Maurice PF, Lee IM, Stamatakis E. Step Accumulation Patterns and Risk for Cardiovascular Events and Mortality Among Suboptimally Active Adults. Annals of Internal Medicine. 2025. doi:10.7326/ANNALS-25-01547.
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    pmid: '41144973'
    doi: 10.7326/annals-25-01547
    titleHash: b077484b59035ae90ebb18f983a8ba0573818c926720ed87b9da99e8b6ce3a58
    url: https://www.acpjournals.org/doi/10.7326/ANNALS-25-01547
  canonicalUrl: https://www.acpjournals.org/doi/10.7326/ANNALS-25-01547
researchEvidence:
  designKind: prospective_cohort
  designLabel: Prospective cohort analysis of step accumulation patterns
  populationLabel: UK Biobank adults aged 40-79 years who were suboptimally active (<8000 steps/day) and without baseline cardiovascular disease or cancer in the accessible report.
  durationLabel: One-week baseline wrist accelerometer exposure assessment; approximately 8 years of follow-up in accessible reports.
  cohortKey: cohort:daily-step-floor/doi-10.7326-annals-25-01547
  participantCount: 33560
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: cadence_intensity_bouts
whyItMatters: A Daily Step Floor can be achieved through many small fragments or more sustained walking; this source helps frame bout pattern as optional interpretation rather than a required prescription.
potentialMurphEndpoints:
- daily_step_count
- step_bout_duration
- all_cause_mortality
- cardiovascular_events
protocolTakeaway: Use as adjacent context that bout structure may matter among suboptimally active adults; do not convert the Daily Step Floor into a mandatory long-bout protocol from this observational evidence.
murphTakeaway: Track total steps first; optionally annotate whether steps came from short fragments or sustained walks when interpreting outcomes.
studyDesign: cohort
modality: step_accumulation_pattern
claimUse: context-only
sourceFindings:
- findingId: finding:daily-step-floor/doi-10.7326-annals-25-01547/step-bout-pattern-cohort
  sourceKey: source_artifact:doi-10.7326-annals-25-01547
  extractedFromArtifactId: art_doi_10_7326_annals_25_01547_source_extract
  findingKind: context
  population: UK Biobank adults aged 40-79 years who were suboptimally active (<8000 steps/day) and without baseline cardiovascular disease or cancer in the accessible report.
  exposure: Daily step accumulation pattern, categorized by the longest/most common bout durations among adults taking fewer than 8000 steps/day.
  outcome: All-cause mortality; cardiovascular disease incidence/events.
  summary: Prospective cohort evidence suggests that among adults taking fewer than 8000 steps/day, accumulating steps in longer bouts was associated with lower mortality and cardiovascular event risk, but the finding is observational and context-only for a step-floor protocol.
  evidenceUse:
  - adjacent_variant
  - context
murphV1Priority: High
pdfRightsStatus: permission_required
---

This source is included for **cadence_intensity_bouts**.

**Findings:** Prospective cohort evidence suggests that among adults taking fewer than 8000 steps/day, accumulating steps in longer bouts was associated with lower mortality and cardiovascular event risk, but the finding is observational and context-only for a step-floor protocol.

**Why it matters:** A Daily Step Floor can be achieved through many small fragments or more sustained walking; this source helps frame bout pattern as optional interpretation rather than a required prescription.

**Potential experiment signals:** daily_step_count, step_bout_duration, all_cause_mortality, cardiovascular_events.

**Protocol takeaway:** Use as adjacent context that bout structure may matter among suboptimally active adults; do not convert the Daily Step Floor into a mandatory long-bout protocol from this observational evidence.

**Claim use:** `context-only`.

## Extraction notes

- **Population:** UK Biobank adults aged 40-79 years who were suboptimally active (<8000 steps/day) and without baseline cardiovascular disease or cancer in the accessible report.
- **Intervention/exposure:** Daily step accumulation pattern, categorized by the longest/most common bout durations among adults taking fewer than 8000 steps/day.
- **Comparator/control:** Adults accumulating most daily steps in shorter bouts (for example, <5-minute bouts) compared with longer bout patterns.
- **Duration/follow-up:** One-week baseline wrist accelerometer exposure assessment; approximately 8 years of follow-up in accessible reports.
- **Endpoints:** All-cause mortality; cardiovascular disease incidence/events.
- **Effect estimates or direction:** Accessible public summaries report lower all-cause mortality and cardiovascular event risk among suboptimally active adults who accumulated steps in longer bouts, after covariate adjustment. Exact model estimates were not extracted from the full article.
- **Adverse events/safety notes:** No adverse events or intervention safety outcomes were reported; this was observational step-pattern research.
- **Limitations:** Observational design; residual confounding and reverse causation remain possible; step accumulation was measured during one baseline week; accessible extraction relied on public abstract/news summaries rather than a redistributable full text.
- **Population mismatch:** Suboptimally active UK Biobank cohort evidence about bout pattern, not a randomized Daily Step Floor intervention.
- **Artifact candidates and rights status:** permission_required; no PDF is included in Git from this extraction. Store metadata/abstract/open text only unless redistribution rights are confirmed.
