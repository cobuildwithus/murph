---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:anses-red-yeast-rice-supplements-warning-2014-08-29"
slug: "sources/red-yeast-rice/anses-red-yeast-rice-supplements-warning-2014-08-29"
title: "Food supplements containing red yeast rice: before consumption, ask advice from a healthcare professional"
summary: "Consumer/regulatory warning from ANSES advising professional advice before using red yeast rice food supplements."
status: "draft"
quality: "usable"
aliases:
  - "French Agency for Food 2014: Food supplements containing red yeast rice: before consumption, ask advice from a healthcare professional"
  - "Food supplements containing red yeast rice: before consumption, ask advice from a healthcare professional"
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
  kind: "web_page"
  title: "Food supplements containing red yeast rice: before consumption, ask advice from a healthcare professional"
  authors: "French Agency for Food, Environmental and Occupational Health & Safety (ANSES)"
  year: 2014
  journal: "ANSES consumer/regulatory warning"
  citation: "French Agency for Food, Environmental and Occupational Health & Safety (ANSES). Food supplements containing red yeast rice: before consumption, ask advice from a healthcare professional. ANSES consumer/regulatory warning. 2014."
  url: "https://www.anses.fr/en/content/food-supplements-containing-red-yeast-rice-consumption-ask-advice-healthcare-professional"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "9b9649db5181fe7d0f84511b0cb8a71bf91e980902bc12c9361f0d58f4d65b11"
    url: "https://www.anses.fr/en/content/food-supplements-containing-red-yeast-rice-consumption-ask-advice-healthcare-professional"
  canonicalUrl: "https://www.anses.fr/en/content/food-supplements-containing-red-yeast-rice-consumption-ask-advice-healthcare-professional"
researchEvidence:
  designKind: "other"
  designLabel: "Consumer/regulatory warning"
  populationLabel: "Consumers considering RYR-containing food supplements"
  durationLabel: "Warning page; no follow-up"
  aggregateRole: "primary"
  cohortKey: "anses-red-yeast-rice-supplements-warning-2014-08-29"
evidenceBucket: "Product quality, contamination, and dose uncertainty"
whyItMatters: "Adds external safety-boundary support from a national food-safety agency."
potentialMurphEndpoints:
  - "healthcare-professional advice"
  - "regulatory warning"
  - "statin-like safety risk"
protocolTakeaway: "Use for contraindication/medical-advice language only."
murphTakeaway: "Use for contraindication/medical-advice language only. It should shape product selection, monitoring, dose fidelity, or safety context without being treated as direct LDL-C efficacy evidence."
studyDesign: "Consumer/regulatory warning"
modality: "Red yeast rice supplement quality/safety context"
claimUse: "safety-only"
sourceFindings:
  -
    findingId: "finding:anses-red-yeast-rice-supplements-warning-2014-08-29:batch-003-primary"
    sourceKey: "source_artifact:anses-red-yeast-rice-supplements-warning-2014-08-29"
    findingKind: "safety"
    population: "Consumers considering RYR-containing food supplements"
    exposure: "Food supplements containing red yeast rice"
    outcome: "healthcare-professional advice; regulatory warning; statin-like safety risk"
    summary: "ANSES warning advises professional advice before consumption; no efficacy estimate."
    evidenceUse:
      - "context"
      - "safety"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
---
This source is included for **Product quality, contamination, and dose uncertainty**.

**Findings:** Consumer/regulatory warning from ANSES advising professional advice before using red yeast rice food supplements.

**Extracted details:**

- **Population / sample:** Consumers considering RYR-containing food supplements
- **Intervention or exposure:** Food supplements containing red yeast rice
- **Comparator / control:** No comparator
- **Duration / follow-up:** Warning page; no follow-up
- **Endpoints:** healthcare-professional advice; regulatory warning; statin-like safety risk
- **Effect estimates or direction:** ANSES warning advises professional advice before consumption; no efficacy estimate.
- **Adverse events or safety notes:** Flags red-yeast-rice supplement safety concerns for general consumers and susceptible groups.
- **Limitations:** Warning page rather than primary research; jurisdiction-specific.
- **Population mismatch:** No protocol trial cohort.
- **Directness:** same_mechanism safety warning

**Why it matters:** Adds external safety-boundary support from a national food-safety agency.

**Potential experiment signals:** healthcare-professional advice; regulatory warning; statin-like safety risk

**Protocol takeaway:** Use for contraindication/medical-advice language only.

**Claim use:** `safety-only`.
