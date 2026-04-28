---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-pure-highly-concentrated-caffeine-2018-04-13
slug: sources/caffeine-timing/fda-pure-highly-concentrated-caffeine-2018-04-13
title: FDA Warns Consumers About Pure and Highly Concentrated Caffeine
summary: FDA consumer warning recommending avoidance of pure/highly concentrated caffeine supplements, especially bulk powders and liquids.
status: draft
quality: usable
aliases:
- FDA warning pure highly concentrated caffeine
categories:
- caffeine-timing
relations:
-
  type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
-
  type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: web_page
  title: FDA Warns Consumers About Pure and Highly Concentrated Caffeine
  authors: U.S. Food and Drug Administration
  year: 2018
  journal: FDA consumer safety communication
  citation: U.S. Food and Drug Administration. FDA Warns Consumers About Pure and Highly Concentrated Caffeine. April 13, 2018.
  url: https://www.fda.gov/food/information-select-dietary-supplement-ingredients-and-other-substances/fda-warns-consumers-about-pure-and-highly-concentrated-caffeine
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:




    titleHash: cea378cc693de78daf47a2315f5762eb9f1123e5ef0925a7a5ec47ae3cffb29b
    url: https://www.fda.gov/food/information-select-dietary-supplement-ingredients-and-other-substances/fda-warns-consumers-about-pure-and-highly-concentrated-caffeine
  canonicalUrl: https://www.fda.gov/food/information-select-dietary-supplement-ingredients-and-other-substances/fda-warns-consumers-about-pure-and-highly-concentrated-caffeine
researchEvidence:
  designKind: guideline
  designLabel: FDA consumer warning
  populationLabel: Consumers of caffeine dietary supplements
  durationLabel: Acute exposure risk
  aggregateRole: primary
  cohortKey: fda-pure-highly-concentrated-caffeine-2018-04-13
evidenceBucket: clinical_safety_boundaries
whyItMatters: Supports clear consumer-facing exclusion of powders and concentrates and escalation instructions for toxicity symptoms.
potentialMurphEndpoints:
- biomarker:caffeine-dose
- biomarker:heart-rate
- biomarker:heart-rhythm
- biomarker:adverse-events
protocolTakeaway: Protocol instructions should explicitly avoid pure/highly concentrated caffeine and should not ask users to self-measure caffeine powder.
murphTakeaway: Consumer-facing high-potency caffeine warning for safety copy.
studyDesign: FDA consumer warning
modality: caffeine safety boundary
claimUse: safety-only
limitations:
- Consumer warning, not a trial; not about ordinary beverage caffeine curfews.
populationMismatch: Product type is concentrated supplement rather than coffee/tea.
directnessToProtocol: general_guideline
sourceFindings:
-
  findingId: finding:fda-pure-highly-concentrated-caffeine-2018-04-13-01
  sourceKey: source_artifact:fda-pure-highly-concentrated-caffeine-2018-04-13
  findingKind: safety
  population: Consumers
  exposure: Bulk pure or highly concentrated caffeine powders/liquids
  outcome: Avoidance recommendation
  summary: FDA warns consumers to avoid dietary supplements consisting of pure or highly concentrated caffeine in powdered or liquid bulk forms because safe amounts can be hard to measure from toxic or lethal amounts.
  evidenceUse:
    - safety
-
  findingId: finding:fda-pure-highly-concentrated-caffeine-2018-04-13-02
  sourceKey: source_artifact:fda-pure-highly-concentrated-caffeine-2018-04-13
  findingKind: adverse_event
  population: Consumers with suspected concentrated-caffeine overdose
  exposure: High-dose caffeine
  outcome: Severe toxicity symptoms and immediate-care trigger
  summary: FDA lists serious effects including rapid or erratic heartbeat, seizures, vomiting, diarrhea, stupor, disorientation, and death, and advises immediate medical care for adverse events.
  evidenceUse:
    - safety
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **clinical_safety_boundaries**.

**Findings:**
- `finding:fda-pure-highly-concentrated-caffeine-2018-04-13-01`: FDA warns consumers to avoid dietary supplements consisting of pure or highly concentrated caffeine in powdered or liquid bulk forms because safe amounts can be hard to measure from toxic or lethal amounts.
- `finding:fda-pure-highly-concentrated-caffeine-2018-04-13-02`: FDA lists serious effects including rapid or erratic heartbeat, seizures, vomiting, diarrhea, stupor, disorientation, and death, and advises immediate medical care for adverse events.

**Why it matters:** Supports clear consumer-facing exclusion of powders and concentrates and escalation instructions for toxicity symptoms.

**Potential experiment signals:**
- biomarker:caffeine-dose
- biomarker:heart-rate
- biomarker:heart-rhythm
- biomarker:adverse-events

**Protocol takeaway:** Protocol instructions should explicitly avoid pure/highly concentrated caffeine and should not ask users to self-measure caffeine powder.

**Claim use:** `safety-only`.
