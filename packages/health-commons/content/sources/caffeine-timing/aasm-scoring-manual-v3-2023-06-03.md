---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:aasm-scoring-manual-v3-2023-06-03
slug: sources/caffeine-timing/aasm-scoring-manual-v3-2023-06-03
title: The AASM Manual for the Scoring of Sleep and Associated Events, Version 3
summary: AASM Manual Version 3 is a PSG/HSAT scoring reference for sleep stages and sleep-related events; it is measurement context only and not caffeine evidence.
status: draft
quality: usable
aliases:
- The AASM Manual for the Scoring of Sleep and Associated Events, Version 3
- source_artifact:aasm-scoring-manual-v3-2023-06-03
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: guideline
  title: The AASM Manual for the Scoring of Sleep and Associated Events, Version 3
  authors: American Academy of Sleep Medicine; Matthew M. Troester; Stuart F. Quan; Richard B. Berry
  year: 2023
  journal: American Academy of Sleep Medicine
  citation: Troester MM, Quan SF, Berry RB, American Academy of Sleep Medicine. The AASM Manual for the Scoring of Sleep and Associated Events, Version 3. American Academy of Sleep Medicine; 2023.
  url: https://shop.aasm.org/products/aasm-scoring-manual-3-ebook
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 7abfb37402997e9c4c2db946743094baf9ad604abfb1da9271f2551df6b4e498
    url: https://shop.aasm.org/products/aasm-scoring-manual-3-ebook
  canonicalUrl: https://shop.aasm.org/products/aasm-scoring-manual-3-ebook
researchEvidence:
  designKind: guideline
  designLabel: Sleep scoring manual / guideline
  populationLabel: Sleep-laboratory and sleep-medicine scoring practice; no participant cohort.
  durationLabel: Version 3 published in 2023; no follow-up period.
  aggregateRole: context
  cohortKey: aasm-scoring-manual-v3-2023-06-03-sleep-laboratory-and-sleep-medicine-scoring-practice-no-participant-cohort
  notes:
  - 'Intervention or exposure: None; scoring rules for PSG and HSAT events.'
  - 'Comparator or control: Not applicable.'
  - 'Endpoints: Sleep stages, arousals, respiratory events, movements, cardiac events, montages, electrode placement, and digitization parameters.'
  - 'Effect or direction: Not an efficacy source.'
  - 'Safety notes: No caffeine safety findings.'
  - 'Limitations: Commercial AASM manual; content is not redistributable as a PDF without permission.'
  - 'Population mismatch: No caffeine-exposed participants.'
  - 'Directness to target protocol: Measurement context only.'
evidenceBucket: external_protocol_claims_and_guidelines
whyItMatters: It anchors PSG terminology and sleep-stage scoring boundaries for any sleep-architecture claims in caffeine timing evidence.
potentialMurphEndpoints:
- PSG sleep stages
- Arousals and sleep-related events
- Sleep architecture terminology
protocolTakeaway: Use only for measurement terminology; it does not support or refute a caffeine curfew.
murphTakeaway: Treat PSG-derived sleep stages as a professional scoring framework and avoid equating consumer-stage outputs with full PSG scoring.
studyDesign: guideline
modality: sleep-scoring-guideline
claimUse: context-only
sourceFindings:
- findingId: finding:aasm-scoring-manual-v3-2023-06-03-psg-scoring-context
  sourceKey: source_artifact:aasm-scoring-manual-v3-2023-06-03
  extractedFromArtifactId: art_aasm_scoring_manual_v3_2023_06_03_html
  findingKind: measurement_validation
  population: Sleep-medicine scoring practice; no participant sample.
  exposure: Use of AASM Version 3 scoring manual for PSG/HSAT scoring.
  outcome: Sleep-stage and sleep-event terminology.
  summary: AASM Manual Version 3 provides professional rules and terminology for PSG/HSAT sleep staging and sleep-related event scoring; it is not caffeine intervention evidence.
  evidenceUse:
  - measurement
  - context
murphV1Priority: High
pdfRightsStatus: permission_required
---

This source is included for **external_protocol_claims_and_guidelines**.

**Findings:** AASM Manual Version 3 provides professional rules and terminology for PSG/HSAT sleep staging and sleep-related event scoring; it is not caffeine intervention evidence.

**Why it matters:** It anchors PSG terminology and sleep-stage scoring boundaries for any sleep-architecture claims in caffeine timing evidence.

**Potential experiment signals:** PSG sleep stages; Arousals and sleep-related events; Sleep architecture terminology.

**Protocol takeaway:** Use only for measurement terminology; it does not support or refute a caffeine curfew.

**Claim use:** `context-only`.
