---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:anses-red-yeast-rice-food-supplements-2014-03-12"
slug: "sources/red-yeast-rice/anses-red-yeast-rice-food-supplements-2014-03-12"
title: "Food supplements containing red yeast rice: before consumption, ask a healthcare professional"
summary: "French regulatory/consumer safety communication emphasizing healthcare-professional advice before consuming red yeast rice supplements."
status: "draft"
quality: "usable"
aliases:
  - "French Agency for Food 2014: Food supplements containing red yeast rice: before consumption, ask a healthcare professional"
  - "Food supplements containing red yeast rice: before consumption, ask a healthcare professional"
categories:
  - "red-yeast-rice"
  - "product-quality"
  - "contamination"
  - "dose-uncertainty"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "guideline"
  title: "Food supplements containing red yeast rice: before consumption, ask a healthcare professional"
  authors: "French Agency for Food, Environmental and Occupational Health & Safety (ANSES)"
  year: 2014
  journal: "ANSES consumer and safety communication"
  citation: "French Agency for Food, Environmental and Occupational Health & Safety (ANSES). Food supplements containing red yeast rice: before consumption, ask a healthcare professional. ANSES consumer and safety communication. 2014."
  url: "https://www.anses.fr/en/content/food-supplements-containing-red-yeast-rice-consumption-ask-healthcare-professional"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "ae7356b5dc3c502f9cb227d8c99d9fb73b9019f800ca9ab2a2d8b31f0e05effb"
    url: "https://www.anses.fr/en/content/food-supplements-containing-red-yeast-rice-consumption-ask-healthcare-professional"
  canonicalUrl: "https://www.anses.fr/en/content/food-supplements-containing-red-yeast-rice-consumption-ask-healthcare-professional"
researchEvidence:
  designKind: "guideline"
  designLabel: "Regulatory safety communication"
  populationLabel: "Consumers considering food supplements containing red yeast rice"
  durationLabel: "Safety communication; no follow-up"
  aggregateRole: "primary"
  cohortKey: "anses-red-yeast-rice-food-supplements-2014-03-12"
evidenceBucket: "Product quality, contamination, and dose uncertainty"
whyItMatters: "Supports medical-supervision and contraindication screening before any RYR experiment."
potentialMurphEndpoints:
  - "healthcare-professional consultation"
  - "contraindication / interaction boundary"
  - "statin-like risk"
  - "nutrivigilance context"
protocolTakeaway: "Use as a safety boundary and jurisdictional-warning source."
murphTakeaway: "Use as a safety boundary and jurisdictional-warning source. It should shape product selection, monitoring, dose fidelity, or safety context without being treated as direct LDL-C efficacy evidence."
studyDesign: "Regulatory safety communication"
modality: "Red yeast rice supplement quality/safety context"
claimUse: "safety-only"
sourceFindings:
  -
    findingId: "finding:anses-red-yeast-rice-food-supplements-2014-03-12:batch-003-primary"
    sourceKey: "source_artifact:anses-red-yeast-rice-food-supplements-2014-03-12"
    findingKind: "safety"
    population: "Consumers considering food supplements containing red yeast rice"
    exposure: "Red yeast rice food supplements marketed for cholesterol management"
    outcome: "healthcare-professional consultation; contraindication / interaction boundary; statin-like risk; nutrivigilance context"
    summary: "ANSES advises asking a healthcare professional before consuming RYR supplements; no clinical lipid-effect estimate."
    evidenceUse:
      - "context"
      - "safety"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
---
This source is included for **Product quality, contamination, and dose uncertainty**.

**Findings:** French regulatory/consumer safety communication emphasizing healthcare-professional advice before consuming red yeast rice supplements.

**Extracted details:**

- **Population / sample:** Consumers considering food supplements containing red yeast rice
- **Intervention or exposure:** Red yeast rice food supplements marketed for cholesterol management
- **Comparator / control:** No comparator
- **Duration / follow-up:** Safety communication; no follow-up
- **Endpoints:** healthcare-professional consultation; contraindication / interaction boundary; statin-like risk; nutrivigilance context
- **Effect estimates or direction:** ANSES advises asking a healthcare professional before consuming RYR supplements; no clinical lipid-effect estimate.
- **Adverse events or safety notes:** Safety-only communication for muscle/liver and interaction concerns associated with monacolin K/lovastatin-like exposure.
- **Limitations:** Regulatory communication, not primary efficacy trial; jurisdiction-specific.
- **Population mismatch:** No protocol trial cohort.
- **Directness:** same_mechanism regulatory safety boundary

**Why it matters:** Supports medical-supervision and contraindication screening before any RYR experiment.

**Potential experiment signals:** healthcare-professional consultation; contraindication / interaction boundary; statin-like risk; nutrivigilance context

**Protocol takeaway:** Use as a safety boundary and jurisdictional-warning source.

**Claim use:** `safety-only`.
