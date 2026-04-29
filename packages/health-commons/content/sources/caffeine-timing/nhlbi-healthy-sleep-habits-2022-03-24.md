---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nhlbi-healthy-sleep-habits-2022-03-24
slug: sources/caffeine-timing/nhlbi-healthy-sleep-habits-2022-03-24
title: Healthy Sleep Habits
summary: NHLBI healthy sleep habits guidance notes caffeine can interfere with sleep and that its effects can last up to 8 hours.
status: draft
quality: usable
aliases:
- Healthy Sleep Habits
- source_artifact:nhlbi-healthy-sleep-habits-2022-03-24
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: guideline
  title: Healthy Sleep Habits
  authors: National Heart, Lung, and Blood Institute
  year: 2022
  journal: NHLBI
  citation: National Heart, Lung, and Blood Institute. Healthy Sleep Habits. March 24, 2022. https://www.nhlbi.nih.gov/health/sleep-deprivation/healthy-sleep-habits.
  url: https://www.nhlbi.nih.gov/health/sleep-deprivation/healthy-sleep-habits
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 22628adb2c6cb23a903d7a9154bc3a8f15bcdb5c4fbd8c0fc02d612411afd58d
    url: https://www.nhlbi.nih.gov/health/sleep-deprivation/healthy-sleep-habits
  canonicalUrl: https://www.nhlbi.nih.gov/health/sleep-deprivation/healthy-sleep-habits
researchEvidence:
  designKind: guideline
  designLabel: Government sleep-hygiene guidance
  populationLabel: General public.
  durationLabel: No intervention follow-up.
  aggregateRole: context
  cohortKey: nhlbi-healthy-sleep-habits-2022-03-24-general-public
  notes:
  - 'Intervention or exposure: Healthy sleep advice that nicotine/caffeine are stimulants and caffeine effects can last up to 8 hours.'
  - 'Comparator or control: Not applicable.'
  - 'Endpoints: Falling asleep and healthy sleep habits.'
  - 'Effect or direction: Guidance only; no original effect estimate.'
  - 'Safety notes: General stimulant/sleep caution.'
  - 'Limitations: Public guidance; not a dose-response trial.'
  - 'Population mismatch: General public.'
  - 'Directness to target protocol: General guideline context.'
evidenceBucket: external_protocol_claims_and_guidelines
whyItMatters: It provides a government source for the 8-hour caffeine-persistence framing.
potentialMurphEndpoints:
- Sleep onset
- Caffeine timing adherence
- Sleep quality
protocolTakeaway: Context-only support for the plausibility of an 8-hour buffer; not direct protocol evidence.
murphTakeaway: An 8-hour buffer is a reasonable public-health framing but should not be presented as a guaranteed individual threshold.
studyDesign: guideline
modality: government-sleep-guidance
claimUse: context-only
sourceFindings:
- findingId: finding:nhlbi-healthy-sleep-habits-2022-03-24-eight-hour-caffeine-persistence
  sourceKey: source_artifact:nhlbi-healthy-sleep-habits-2022-03-24
  extractedFromArtifactId: art_nhlbi_healthy_sleep_habits_2022_03_24_html
  findingKind: context
  population: General public.
  exposure: NHLBI healthy sleep habits guidance.
  outcome: 8-hour caffeine persistence framing.
  summary: NHLBI states that caffeine can interfere with sleep and that its effects can last up to 8 hours, supporting public-health context for an 8-hour buffer.
  evidenceUse:
  - context
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **external_protocol_claims_and_guidelines**.

**Findings:** NHLBI states that caffeine can interfere with sleep and that its effects can last up to 8 hours, supporting public-health context for an 8-hour buffer.

**Why it matters:** It provides a government source for the 8-hour caffeine-persistence framing.

**Potential experiment signals:** Sleep onset; Caffeine timing adherence; Sleep quality.

**Protocol takeaway:** Context-only support for the plausibility of an 8-hour buffer; not direct protocol evidence.

**Claim use:** `context-only`.
