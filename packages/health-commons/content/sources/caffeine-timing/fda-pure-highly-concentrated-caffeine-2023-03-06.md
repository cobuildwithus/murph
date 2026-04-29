---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-pure-highly-concentrated-caffeine-2023-03-06
slug: sources/caffeine-timing/fda-pure-highly-concentrated-caffeine-2023-03-06
title: Pure and Highly Concentrated Caffeine
summary: Current FDA consumer page describing deaths, measurement hazards, and severe toxicity symptoms from pure/highly concentrated caffeine products.
status: draft
quality: usable
aliases:
- FDA pure and highly concentrated caffeine current page
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: web_page
  title: Pure and Highly Concentrated Caffeine
  authors: U.S. Food and Drug Administration
  year: 2023
  journal: FDA consumer safety webpage
  citation: U.S. Food and Drug Administration. Pure and Highly Concentrated Caffeine. Current as of March 6, 2023.
  url: https://www.fda.gov/food/information-consumers-using-dietary-supplements/pure-and-highly-concentrated-caffeine
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: 761f5b8b6d736df1ee3d0947bff6c51434f5b8d189eff4b4fa5efe5867a727df
    url: https://www.fda.gov/food/information-consumers-using-dietary-supplements/pure-and-highly-concentrated-caffeine
  canonicalUrl: https://www.fda.gov/food/information-consumers-using-dietary-supplements/pure-and-highly-concentrated-caffeine
researchEvidence:
  designKind: guideline
  designLabel: FDA consumer safety page
  populationLabel: Consumers of dietary supplements
  durationLabel: Acute exposure risk
  aggregateRole: primary
  cohortKey: fda-pure-highly-concentrated-caffeine-2023-03-06
evidenceBucket: clinical_safety_boundaries
whyItMatters: This is the clearest current FDA red-flag source for excluding concentrated caffeine products from a self-experiment.
potentialMurphEndpoints:
- biomarker:caffeine-dose
- biomarker:heart-rate
- biomarker:heart-rhythm
- biomarker:adverse-events
protocolTakeaway: Only ordinary dietary caffeine sources should be considered; concentrated caffeine products are outside the protocol and warrant warning language.
murphTakeaway: High-priority toxicity/product-form guardrail.
studyDesign: FDA consumer safety page
modality: caffeine safety boundary
claimUse: safety-only
limitations:
- Consumer safety page; not a clinical sleep study.
populationMismatch: Applies to concentrated product users rather than routine beverage consumers.
directnessToProtocol: general_guideline
sourceFindings:
- findingId: finding:fda-pure-highly-concentrated-caffeine-2023-03-06-01
  sourceKey: source_artifact:fda-pure-highly-concentrated-caffeine-2023-03-06
  extractedFromArtifactId: art_fda_pure_highly_concentrated_caffeine_2023_03_06_html
  findingKind: safety
  population: Consumers
  exposure: Pure and highly concentrated caffeine products
  outcome: Small margin between safe and toxic amounts
  summary: FDA states that pure/highly concentrated caffeine products present a significant public-health threat, have contributed to at least two deaths, and are difficult to measure accurately with common kitchen tools.
  evidenceUse:
  - safety
- findingId: finding:fda-pure-highly-concentrated-caffeine-2023-03-06-02
  sourceKey: source_artifact:fda-pure-highly-concentrated-caffeine-2023-03-06
  extractedFromArtifactId: art_fda_pure_highly_concentrated_caffeine_2023_03_06_html
  findingKind: safety
  population: Consumers
  exposure: Powdered or liquid caffeine concentrate
  outcome: Cup-equivalent hazard
  summary: FDA gives examples that one teaspoon of powdered caffeine can equal about 28 cups of coffee and half a cup of concentrated liquid caffeine can equal more than 20 cups of coffee.
  evidenceUse:
  - safety
- findingId: finding:fda-pure-highly-concentrated-caffeine-2023-03-06-03
  sourceKey: source_artifact:fda-pure-highly-concentrated-caffeine-2023-03-06
  extractedFromArtifactId: art_fda_pure_highly_concentrated_caffeine_2023_03_06_html
  findingKind: adverse_event
  population: Consumers
  exposure: High-dose caffeine products
  outcome: Rapid/erratic heartbeat, seizures, death and other symptoms
  summary: FDA lists severe effects including rapid or erratic heartbeat, seizures, death, vomiting, diarrhea, stupor, and disorientation.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **clinical_safety_boundaries**.

**Findings:**
- `finding:fda-pure-highly-concentrated-caffeine-2023-03-06-01`: FDA states that pure/highly concentrated caffeine products present a significant public-health threat, have contributed to at least two deaths, and are difficult to measure accurately with common kitchen tools.
- `finding:fda-pure-highly-concentrated-caffeine-2023-03-06-02`: FDA gives examples that one teaspoon of powdered caffeine can equal about 28 cups of coffee and half a cup of concentrated liquid caffeine can equal more than 20 cups of coffee.
- `finding:fda-pure-highly-concentrated-caffeine-2023-03-06-03`: FDA lists severe effects including rapid or erratic heartbeat, seizures, death, vomiting, diarrhea, stupor, and disorientation.

**Why it matters:** This is the clearest current FDA red-flag source for excluding concentrated caffeine products from a self-experiment.

**Potential experiment signals:**
- biomarker:caffeine-dose
- biomarker:heart-rate
- biomarker:heart-rhythm
- biomarker:adverse-events

**Protocol takeaway:** Only ordinary dietary caffeine sources should be considered; concentrated caffeine products are outside the protocol and warrant warning language.

**Claim use:** `safety-only`.
