---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:healthcanada-caffeinated-energy-drinks-2024-05-02
slug: sources/caffeine-timing/healthcanada-caffeinated-energy-drinks-2024-05-02
title: Caffeinated energy drinks
summary: Health Canada regulatory page for caffeinated energy-drink dose limits, label cautions, and natural caffeine sources such as guarana and yerba mate.
status: draft
quality: usable
aliases:
- Health Canada caffeinated energy drinks
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: guideline
  title: Caffeinated energy drinks
  authors: Health Canada
  year: 2024
  journal: Government of Canada webpage
  citation: Health Canada. Caffeinated energy drinks. May 2, 2024.
  url: https://www.canada.ca/en/health-canada/services/food-nutrition/supplemented-foods/caffeinated-energy-drinks.html
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: bd6155bf3611bb9c9474579283a4e96d801ff84335b08b2c21200aececb74cac
    url: https://www.canada.ca/en/health-canada/services/food-nutrition/supplemented-foods/caffeinated-energy-drinks.html
  canonicalUrl: https://www.canada.ca/en/health-canada/services/food-nutrition/supplemented-foods/caffeinated-energy-drinks.html
researchEvidence:
  designKind: guideline
  designLabel: Health Canada regulatory guidance
  populationLabel: Consumers of caffeinated energy drinks
  durationLabel: Per serving and daily use-label context
  aggregateRole: primary
  cohortKey: healthcanada-caffeinated-energy-drinks-2024-05-02
evidenceBucket: clinical_safety_boundaries
whyItMatters: Energy drinks can obscure caffeine dose via multiple sources and are relevant to protocol dose audit, especially for youth, pregnancy/lactation, and caffeine-sensitive users.
potentialMurphEndpoints:
- biomarker:caffeine-dose
- biomarker:sleep-onset-latency
- biomarker:adverse-events
protocolTakeaway: When logging caffeine, count energy drinks and natural caffeine sources; do not generalize the curfew protocol to children, pregnancy/lactation, or caffeine-sensitive energy-drink use without clinician guidance.
murphTakeaway: Useful official source for energy-drink dose and labeling boundaries.
studyDesign: Health Canada regulatory guidance
modality: caffeine safety boundary
claimUse: safety-only
limitations:
- Canadian regulatory context; label rules differ by country; not protocol efficacy evidence.
populationMismatch: Energy-drink consumers and regulated Canadian products differ from ordinary adult coffee/tea curfew participants.
directnessToProtocol: general_guideline
sourceFindings:
- findingId: finding:healthcanada-caffeinated-energy-drinks-2024-05-02-01
  sourceKey: source_artifact:healthcanada-caffeinated-energy-drinks-2024-05-02
  extractedFromArtifactId: art_healthcanada_caffeinated_energy_drinks_2024_05_02_html
  findingKind: safety
  population: Canadian consumers of caffeinated energy drinks
  exposure: Caffeinated energy drinks with caffeine from all sources
  outcome: Per-serving caffeine limit
  summary: Health Canada states that caffeinated energy drinks are limited to 180 mg caffeine per serving from all sources.
  evidenceUse:
  - safety
  - context
- findingId: finding:healthcanada-caffeinated-energy-drinks-2024-05-02-02
  sourceKey: source_artifact:healthcanada-caffeinated-energy-drinks-2024-05-02
  extractedFromArtifactId: art_healthcanada_caffeinated_energy_drinks_2024_05_02_html
  findingKind: context
  population: Consumers
  exposure: Energy drinks containing guarana, yerba mate, or other ingredients
  outcome: Natural-source caffeine disclosure/audit
  summary: Health Canada notes that caffeinated energy drinks may contain guarana and yerba mate, which are natural caffeine sources, supporting all-source caffeine accounting.
  evidenceUse:
  - context
  - safety
- findingId: finding:healthcanada-caffeinated-energy-drinks-2024-05-02-03
  sourceKey: source_artifact:healthcanada-caffeinated-energy-drinks-2024-05-02
  extractedFromArtifactId: art_healthcanada_caffeinated_energy_drinks_2024_05_02_html
  findingKind: safety
  population: Children under 14, pregnant or breastfeeding people, and caffeine-sensitive people
  exposure: Caffeinated energy drinks
  outcome: Label cautions and population exclusions
  summary: Health Canada describes required cautionary labeling and states that children, pregnant or breastfeeding people, and caffeine-sensitive people should not consume caffeinated energy drinks.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **clinical_safety_boundaries**.

**Findings:**
- `finding:healthcanada-caffeinated-energy-drinks-2024-05-02-01`: Health Canada states that caffeinated energy drinks are limited to 180 mg caffeine per serving from all sources.
- `finding:healthcanada-caffeinated-energy-drinks-2024-05-02-02`: Health Canada notes that caffeinated energy drinks may contain guarana and yerba mate, which are natural caffeine sources, supporting all-source caffeine accounting.
- `finding:healthcanada-caffeinated-energy-drinks-2024-05-02-03`: Health Canada describes required cautionary labeling and states that children, pregnant or breastfeeding people, and caffeine-sensitive people should not consume caffeinated energy drinks.

**Why it matters:** Energy drinks can obscure caffeine dose via multiple sources and are relevant to protocol dose audit, especially for youth, pregnancy/lactation, and caffeine-sensitive users.

**Potential experiment signals:**
- biomarker:caffeine-dose
- biomarker:sleep-onset-latency
- biomarker:adverse-events

**Protocol takeaway:** When logging caffeine, count energy drinks and natural caffeine sources; do not generalize the curfew protocol to children, pregnancy/lactation, or caffeine-sensitive energy-drink use without clinician guidance.

**Claim use:** `safety-only`.
