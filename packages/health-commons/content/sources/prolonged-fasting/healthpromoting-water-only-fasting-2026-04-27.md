---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:healthpromoting-water-only-fasting-2026-04-27
slug: sources/prolonged-fasting/healthpromoting-water-only-fasting-2026-04-27
title: About Water-Only Fasting
summary: TrueNorth Health Center page defining water-only fasting as water plus complete rest, with medical screening, contraindication examples, typical fast durations, and supervised refeeding.
status: draft
quality: usable
aliases:
  - TrueNorth About Water-Only Fasting
  - HealthPromoting water-only fasting
categories:
  - prolonged-fasting
relations:
  -
    type: related_protocol
    target: protocol_variant:prolonged-fasting/prolonged-fasting-24-72-hours
  -
    type: parent_family
    target: experiment_family:prolonged-fasting
source:
  kind: external_protocol
  title: About Water-Only Fasting
  authors: TrueNorth Health Center / HealthPromoting.com
  year: 2026
  journal: TrueNorth Health Center
  citation: TrueNorth Health Center. About Water-Only Fasting. Accessed 2026-04-27 for batch-011.
  url: https://healthpromoting.com/about-water-only-fasting
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://healthpromoting.com/about-water-only-fasting
    titleHash: 24e8501306d9963538bbe4b8f747ced2278cd37db9d453b9fd8867452563f875
  canonicalUrl: https://healthpromoting.com/about-water-only-fasting
researchEvidence:
  designKind: expert_protocol
  designLabel: External clinic water-only fasting protocol
  populationLabel: Prospective TrueNorth fasting participants after medical review.
  durationLabel: Page states fasts typically continue for 5 to 40 days, followed by refeeding no less than half the length of the fast.
  aggregateRole: context
  cohortKey: cohort:prolonged-fasting-healthpromoting-water-only
evidenceBucket: implementation, hydration, and refeed context
whyItMatters: This external clinic protocol defines water-only fasting as a rest-based, medically screened intervention and separates the fast from a supervised refeeding period.
potentialMurphEndpoints:
  - blood pressure
  - blood glucose
  - lipids
  - liver enzymes
  - inflammation markers
  - urine specific gravity
  - refeeding tolerance
protocolTakeaway: 'Use only as external protocol context: its typical 5–40 day supervised water-only model is outside the 24–72 hour Murph target and should not be promoted as direct evidence.'
murphTakeaway: True water-only fasting protocols may pair water-only intake with rest, pre-screening, and extended refeeding; Murph protocol copy should be explicit when it does not reproduce those conditions.
studyDesign: External clinic protocol / implementation guidance.
modality: Water-only fasting in a rest and medical-supervision environment.
claimUse: context-only
sourceFindings:
  -
    findingId: finding:healthpromoting-water-only-fasting-2026-04-27-water-only-rest-screening-refeed
    findingKind: context
    population: TrueNorth Health Center fasting participants considered for water-only fasting.
    exposure: Water-only fasting in complete rest with medical examination and possible laboratory review.
    outcome: External protocol implementation and contraindication boundaries.
    summary: The page defines fasting as abstinence from all substances except pure water in complete rest, requires a physical examination and possible laboratory testing, lists relative contraindications such as pregnancy, extreme weakness, inadequate reserves, kidney problems, cardiac instability, certain medications, and some cancers, describes typical fasts as 5–40 days, and states refeeding is typically no less than one-half the fast length.
    evidenceUse:
      - context
      - safety
      - adjacent_variant
    sourceKey: source_artifact:healthpromoting-water-only-fasting-2026-04-27
    extractedFromArtifactId: art_healthpromoting_water_only_fasting_2026_04_27_source_record
murphV1Priority: High
pdfRightsStatus: unknown
directnessToProtocol: clinical_supervised
populationMismatch: Medically reviewed, often longer-duration clinic participants do not directly match self-guided 24–72 hour fasters.
limitations:
  - Clinic protocol page; no controlled comparator, no participant count, commercial context, and typical durations exceed the 24–72 hour protocol target.
claimUseBoundary: context-only
---

This source is included for **implementation, hydration, and refeed context**.

**Findings:**
- `finding:healthpromoting-water-only-fasting-2026-04-27-water-only-rest-screening-refeed` — The page defines fasting as abstinence from all substances except pure water in complete rest, requires a physical examination and possible laboratory testing, lists relative contraindications such as pregnancy, extreme weakness, inadequate reserves, kidney problems, cardiac instability, certain medications, and some cancers, describes typical fasts as 5–40 days, and states refeeding is typically no less than one-half the fast length.

**Why it matters:** This external clinic protocol defines water-only fasting as a rest-based, medically screened intervention and separates the fast from a supervised refeeding period.

**Potential experiment signals:** blood pressure, blood glucose, lipids, liver enzymes, inflammation markers, urine specific gravity, refeeding tolerance.

**Protocol takeaway:** Use only as external protocol context: its typical 5–40 day supervised water-only model is outside the 24–72 hour Murph target and should not be promoted as direct evidence.

**Directness to Prolonged Fasting (24–72 Hours):** `clinical_supervised`.

**Population mismatch:** Medically reviewed, often longer-duration clinic participants do not directly match self-guided 24–72 hour fasters.

**Limitations:** Clinic protocol page; no controlled comparator, no participant count, commercial context, and typical durations exceed the 24–72 hour protocol target.

**Claim use:** `context-only`.

**Artifact and rights note:** Source page draft only. PDF rights status: `unknown`. No copyrighted PDF content is included.
