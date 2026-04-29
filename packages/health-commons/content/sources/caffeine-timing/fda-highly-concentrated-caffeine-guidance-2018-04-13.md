---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-highly-concentrated-caffeine-guidance-2018-04-13
slug: sources/caffeine-timing/fda-highly-concentrated-caffeine-guidance-2018-04-13
title: 'Highly Concentrated Caffeine in Dietary Supplements: Guidance for Industry'
summary: FDA guidance identifying pure or highly concentrated caffeine supplements as a public-health hazard because small measurement errors can create toxic or lethal doses.
status: draft
quality: usable
aliases:
- FDA highly concentrated caffeine guidance
- Highly concentrated caffeine in dietary supplements guidance
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: guideline
  title: 'Highly Concentrated Caffeine in Dietary Supplements: Guidance for Industry'
  authors: U.S. Food and Drug Administration
  year: 2018
  journal: FDA guidance document
  citation: 'U.S. Food and Drug Administration. Highly Concentrated Caffeine in Dietary Supplements: Guidance for Industry. April 2018.'
  url: https://www.fda.gov/files/food/published/Guidance-for-Industry--Highly-Concentrated-Caffeine-in-Dietary-Supplements-DOWNLOAD.pdf
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: f8b8f055a7765d6f7253924d9d410f59b156ef3574060268edc69a00012411ea
    url: https://www.fda.gov/files/food/published/Guidance-for-Industry--Highly-Concentrated-Caffeine-in-Dietary-Supplements-DOWNLOAD.pdf
  canonicalUrl: https://www.fda.gov/files/food/published/Guidance-for-Industry--Highly-Concentrated-Caffeine-in-Dietary-Supplements-DOWNLOAD.pdf
researchEvidence:
  designKind: guideline
  designLabel: FDA guidance for industry
  populationLabel: Consumers of caffeine dietary supplements
  durationLabel: Acute exposure and product-use risk
  aggregateRole: primary
  cohortKey: fda-highly-concentrated-caffeine-guidance-2018-04-13
evidenceBucket: clinical_safety_boundaries
whyItMatters: A curfew/reset protocol should exclude pure powders and concentrates; their risk profile is not comparable to coffee, tea, or ordinary caffeinated beverages.
potentialMurphEndpoints:
- biomarker:caffeine-dose
- biomarker:heart-rate
- biomarker:heart-rhythm
- biomarker:adverse-events
protocolTakeaway: Exclude pure or highly concentrated caffeine powders/liquids from protocol instructions and recommend urgent care/Poison Control pathways for overdose symptoms.
murphTakeaway: High-priority product-form boundary for dose-reset safety language.
studyDesign: FDA guidance for industry
modality: caffeine safety boundary
claimUse: safety-only
limitations:
- Regulatory guidance, not an efficacy trial; the guidance focuses on dietary supplement product safety rather than ordinary beverage caffeine timing.
populationMismatch: Applies to users of concentrated caffeine products, not typical coffee/tea consumers.
directnessToProtocol: general_guideline
sourceFindings:
- findingId: finding:fda-highly-concentrated-caffeine-guidance-2018-04-13-01
  sourceKey: source_artifact:fda-highly-concentrated-caffeine-guidance-2018-04-13
  extractedFromArtifactId: art_fda_highly_concentrated_caffeine_guidance_2018_04_13_pdf
  findingKind: safety
  population: Consumers of dietary supplements
  exposure: Pure or highly concentrated powdered/liquid caffeine sold in bulk
  outcome: Toxic or life-threatening dosing risk
  summary: The FDA guidance describes bulk pure or highly concentrated caffeine products in which consumers must measure a small safe serving from a potentially toxic or lethal amount of product.
  evidenceUse:
  - safety
- findingId: finding:fda-highly-concentrated-caffeine-guidance-2018-04-13-02
  sourceKey: source_artifact:fda-highly-concentrated-caffeine-guidance-2018-04-13
  extractedFromArtifactId: art_fda_highly_concentrated_caffeine_guidance_2018_04_13_pdf
  findingKind: adverse_event
  population: Consumers of concentrated caffeine products
  exposure: High-dose caffeine exposure
  outcome: Tachycardia, ventricular arrhythmia, seizures, life-threatening toxicity
  summary: The guidance identifies toxic effects such as tachycardia, ventricular arrhythmia, and seizures around 1,200 mg and describes life-threatening doses typically estimated at 10,000-14,000 mg, with smaller doses potentially life-threatening in sensitive individuals.
  evidenceUse:
  - safety
- findingId: finding:fda-highly-concentrated-caffeine-guidance-2018-04-13-03
  sourceKey: source_artifact:fda-highly-concentrated-caffeine-guidance-2018-04-13
  extractedFromArtifactId: art_fda_highly_concentrated_caffeine_guidance_2018_04_13_pdf
  findingKind: safety
  population: Consumers using bulk powdered caffeine
  exposure: Household measurement of tiny servings
  outcome: Measurement-error hazard
  summary: The guidance explains that serving sizes such as 1/64 to 1/16 teaspoon can be impractical to measure accurately with household tools, making accidental toxic dosing foreseeable.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **clinical_safety_boundaries**.

**Findings:**
- `finding:fda-highly-concentrated-caffeine-guidance-2018-04-13-01`: The FDA guidance describes bulk pure or highly concentrated caffeine products in which consumers must measure a small safe serving from a potentially toxic or lethal amount of product.
- `finding:fda-highly-concentrated-caffeine-guidance-2018-04-13-02`: The guidance identifies toxic effects such as tachycardia, ventricular arrhythmia, and seizures around 1,200 mg and describes life-threatening doses typically estimated at 10,000-14,000 mg, with smaller doses potentially life-threatening in sensitive individuals.
- `finding:fda-highly-concentrated-caffeine-guidance-2018-04-13-03`: The guidance explains that serving sizes such as 1/64 to 1/16 teaspoon can be impractical to measure accurately with household tools, making accidental toxic dosing foreseeable.

**Why it matters:** A curfew/reset protocol should exclude pure powders and concentrates; their risk profile is not comparable to coffee, tea, or ordinary caffeinated beverages.

**Potential experiment signals:**
- biomarker:caffeine-dose
- biomarker:heart-rate
- biomarker:heart-rhythm
- biomarker:adverse-events

**Protocol takeaway:** Exclude pure or highly concentrated caffeine powders/liquids from protocol instructions and recommend urgent care/Poison Control pathways for overdose symptoms.

**Claim use:** `safety-only`.
