---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:medlineplus-healthy-sleep-2025-12-09
slug: sources/caffeine-timing/medlineplus-healthy-sleep-2025-12-09
title: Healthy Sleep
summary: MedlinePlus healthy sleep guidance advises avoiding caffeine, especially in the afternoon and evening, and limiting shift-work caffeine to the first part of the shift.
status: draft
quality: usable
aliases:
- Healthy Sleep
- source_artifact:medlineplus-healthy-sleep-2025-12-09
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: guideline
  title: Healthy Sleep
  authors: MedlinePlus / National Library of Medicine
  year: 2025
  journal: MedlinePlus
  citation: MedlinePlus. Healthy Sleep. Updated December 9, 2025. https://medlineplus.gov/healthysleep.html.
  url: https://medlineplus.gov/healthysleep.html
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 2f9a35adee92f3676ef99e3d14fdd8e074f0007e99d4ebe76797a9f08c7a8ac5
    url: https://medlineplus.gov/healthysleep.html
  canonicalUrl: https://medlineplus.gov/healthysleep.html
researchEvidence:
  designKind: guideline
  designLabel: NIH consumer health page
  populationLabel: General public.
  durationLabel: No intervention follow-up.
  aggregateRole: context
  cohortKey: medlineplus-healthy-sleep-2025-12-09-general-public
  notes:
  - 'Intervention or exposure: Healthy sleep guidance including avoiding caffeine, especially afternoon/evening, and shift-work timing advice.'
  - 'Comparator or control: Not applicable.'
  - 'Endpoints: Healthy sleep behaviors and sleep hygiene.'
  - 'Effect or direction: Guidance only; no original effect estimate.'
  - 'Safety notes: General guidance only.'
  - 'Limitations: Consumer health page; not a caffeine-timing trial.'
  - 'Population mismatch: General public.'
  - 'Directness to target protocol: General guideline context.'
evidenceBucket: external_protocol_claims_and_guidelines
whyItMatters: It provides concise NIH consumer-health wording for afternoon/evening caffeine cutoffs.
potentialMurphEndpoints:
- Sleep quality
- Sleep timing
- Caffeine timing adherence
protocolTakeaway: Context-only source for mainstream wording; not primary efficacy evidence.
murphTakeaway: NIH consumer guidance supports avoiding afternoon/evening caffeine as sleep hygiene, while personal response should be tracked.
studyDesign: guideline
modality: government-consumer-health-guidance
claimUse: context-only
sourceFindings:
- findingId: finding:medlineplus-healthy-sleep-2025-12-09-afternoon-evening-caffeine-guidance
  sourceKey: source_artifact:medlineplus-healthy-sleep-2025-12-09
  extractedFromArtifactId: art_medlineplus_healthy_sleep_2025_12_09_html
  findingKind: context
  population: General public.
  exposure: MedlinePlus healthy sleep advice.
  outcome: Recommendation to avoid caffeine, especially afternoon/evening.
  summary: MedlinePlus lists avoiding caffeine, especially in the afternoon and evening, as part of healthy sleep guidance.
  evidenceUse:
  - context
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **external_protocol_claims_and_guidelines**.

**Findings:** MedlinePlus lists avoiding caffeine, especially in the afternoon and evening, as part of healthy sleep guidance.

**Why it matters:** It provides concise NIH consumer-health wording for afternoon/evening caffeine cutoffs.

**Potential experiment signals:** Sleep quality; Sleep timing; Caffeine timing adherence.

**Protocol takeaway:** Context-only source for mainstream wording; not primary efficacy evidence.

**Claim use:** `context-only`.
