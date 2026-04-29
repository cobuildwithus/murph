---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:sleepfoundation-caffeine-wear-off-2025-07-16
slug: sources/caffeine-timing/sleepfoundation-caffeine-wear-off-2025-07-16
title: How Long Does It Take for Caffeine to Wear Off?
summary: This medically reviewed Sleep Foundation explainer says caffeine effects can last 2-12 hours, lists individual sensitivity factors such as genetics, pregnancy, oral contraceptives, and smoking, and recommends avoiding caffeine at least eight hours before bedtime; it is public-facing context, not primary efficacy evidence.
status: draft
quality: usable
aliases:
- How Long Does It Take for Caffeine to Wear Off?
- source_artifact:sleepfoundation-caffeine-wear-off-2025-07-16
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: web_page
  title: How Long Does It Take for Caffeine to Wear Off?
  authors: Rob Newsom; medically reviewed by Anis Rehman, MD
  year: 2025
  journal: SleepFoundation.org
  citation: Newsom R. How Long Does It Take for Caffeine to Wear Off? Sleep Foundation. Updated July 16, 2025. Medically reviewed by Anis Rehman, MD.
  url: https://www.sleepfoundation.org/nutrition/how-long-does-it-take-caffeine-to-wear-off
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://www.sleepfoundation.org/nutrition/how-long-does-it-take-caffeine-to-wear-off
  canonicalUrl: https://www.sleepfoundation.org/nutrition/how-long-does-it-take-caffeine-to-wear-off
researchEvidence:
  designKind: other
  designLabel: Public-facing medically reviewed explainer
  populationLabel: General public sleep-health audience.
  durationLabel: Not an intervention study.
  aggregateRole: context
  cohortKey: sleepfoundation-caffeine-wear-off-2025-07-16
  notes:
  - 'Intervention or exposure: Caffeine duration, half-life, individual sensitivity factors, and bedtime timing advice.'
  - 'Comparator or control: None; public-facing explanatory article.'
  - 'Endpoints: Caffeine onset/duration, sleep disruption risk, and bedtime cutoff recommendation.'
  - 'Effect or direction: Article states effects can last 2-12 hours and recommends avoiding caffeine at least eight hours before bedtime; sensitive people may need an earlier cutoff.'
  - 'Safety notes: Notes caution for people with sleep disorders, migraines/headaches, anxiety, reflux/ulcers, cardiovascular disease/arrhythmia, liver/kidney disease, seizures, pregnancy/breastfeeding, and certain medications.'
  - 'Population mismatch: General guidance, not a primary study or 14-day protocol test.'
  - 'Limitation: Secondary/public-health guidance; use for external protocol-context wording only.'
evidenceBucket: pharmacology_individual_differences
whyItMatters: It reinforces the exact consumer-friendly implementation language of an eight-hour caffeine cutoff while emphasizing individual sensitivity.
potentialMurphEndpoints:
- caffeine cutoff adherence
- sleep-onset latency
- sleep quality rating
- side-effect log
protocolTakeaway: Use as external guideline/context support for the eight-hour instruction, not as primary evidence of protocol efficacy.
murphTakeaway: The protocol can phrase the rule simply as “avoid caffeine at least eight hours before bed,” while advising earlier cutoff for sensitive users.
studyDesign: other
modality: external-protocol-context
claimUse: context-only
sourceFindings:
- findingId: finding:sleepfoundation-2025-caffeine-eight-hour-cutoff
  sourceKey: source_artifact:sleepfoundation-caffeine-wear-off-2025-07-16
  extractedFromArtifactId: art_sleepfoundation-caffeine-wear-off-2025-07-16_html
  findingKind: context
  population: General public sleep-health audience.
  exposure: Caffeine consumption timing relative to bedtime.
  outcome: Recommended caffeine cutoff and expected duration of effects
  summary: The Sleep Foundation page states caffeine effects can last 2-12 hours and recommends avoiding caffeine at least eight hours before bedtime, with earlier cutoff potentially needed for sensitive individuals.
  evidenceUse:
  - context
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **pharmacology_individual_differences**.

**Findings:** The Sleep Foundation page states caffeine effects can last 2-12 hours and recommends avoiding caffeine at least eight hours before bedtime, with earlier cutoff potentially needed for sensitive individuals.

**Why it matters:** It reinforces the exact consumer-friendly implementation language of an eight-hour caffeine cutoff while emphasizing individual sensitivity.

**Potential experiment signals:** caffeine cutoff adherence, sleep-onset latency, sleep quality rating, side-effect log.

**Protocol takeaway:** Use as external guideline/context support for the eight-hour instruction, not as primary evidence of protocol efficacy.

**Claim use:** `context-only`.
