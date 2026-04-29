---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:mayoclinic-red-yeast-rice-2025-03-27"
slug: "sources/red-yeast-rice/mayoclinic-red-yeast-rice-2025-03-27"
title: "Red yeast rice"
summary: "Consumer monograph emphasizing that RYR effects and risks depend on monacolin K content and contaminant control."
status: "draft"
quality: "usable"
aliases:
  - "Mayo Clinic Staff 2025: Red yeast rice"
  - "Mayo Clinic red yeast rice monograph"
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
  title: "Red yeast rice"
  authors: "Mayo Clinic Staff"
  year: 2025
  journal: "Mayo Clinic Drugs and Supplements"
  citation: "Mayo Clinic Staff. Red yeast rice. Mayo Clinic Drugs and Supplements. 2025."
  url: "https://www.mayoclinic.org/drugs-supplements-red-yeast-rice/art-20363074"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    url: "https://www.mayoclinic.org/drugs-supplements-red-yeast-rice/art-20363074"
  canonicalUrl: "https://www.mayoclinic.org/drugs-supplements-red-yeast-rice/art-20363074"
researchEvidence:
  designKind: "other"
  designLabel: "Clinical consumer monograph"
  populationLabel: "Consumers considering red yeast rice supplements"
  durationLabel: "Consumer safety reference; no intervention follow-up"
  aggregateRole: "primary"
  cohortKey: "mayoclinic-red-yeast-rice-2025-03-27"
evidenceBucket: "Product quality, contamination, and dose uncertainty"
whyItMatters: "Useful for patient-facing safety boundaries and for noting that label/product uncertainty can change both efficacy and risk."
potentialMurphEndpoints:
  - "LDL-C/total cholesterol context"
  - "monacolin K content variability"
  - "citrinin contamination"
  - "statin-like adverse effects"
  - "drug interactions"
protocolTakeaway: "Use as a safety and consumer-communication source, not as a primary efficacy estimate."
murphTakeaway: "Use as a safety and consumer-communication source, not as a primary efficacy estimate. It should shape product selection, monitoring, dose fidelity, or safety context without being treated as direct LDL-C efficacy evidence."
studyDesign: "Clinical consumer monograph"
modality: "Red yeast rice supplement quality/safety context"
claimUse: "safety-only"
sourceFindings:

  -
    findingId: "finding:mayoclinic-red-yeast-rice-2025-03-27:batch-003-primary"
    sourceKey: "source_artifact:mayoclinic-red-yeast-rice-2025-03-27"
    findingKind: "safety"
    population: "Consumers considering red yeast rice supplements"
    exposure: "Red yeast rice products, including products with variable monacolin K and possible citrinin contamination"
    outcome: "LDL-C/total cholesterol context; monacolin K content variability; citrinin contamination; statin-like adverse effects; drug interactions"
    summary: "Consumer monograph states that products with high monacolin K may lower cholesterol, but products with little monacolin K may have little effect; no original effect estimate."
    evidenceUse:
      - "context"
      - "safety"
murphV1Priority: "Medium"
pdfRightsStatus: "unknown"
---
This source is included for **Product quality, contamination, and dose uncertainty**.

**Findings:** Consumer monograph emphasizing that RYR effects and risks depend on monacolin K content and contaminant control.

**Extracted details:**

- **Population / sample:** Consumers considering red yeast rice supplements
- **Intervention or exposure:** Red yeast rice products, including products with variable monacolin K and possible citrinin contamination
- **Comparator / control:** No comparator
- **Duration / follow-up:** Consumer safety reference; no intervention follow-up
- **Endpoints:** LDL-C/total cholesterol context; monacolin K content variability; citrinin contamination; statin-like adverse effects; drug interactions
- **Effect estimates or direction:** Consumer monograph states that products with high monacolin K may lower cholesterol, but products with little monacolin K may have little effect; no original effect estimate.
- **Adverse events or safety notes:** Lists statin-like muscle, liver, and kidney concerns; cautions against pregnancy/breastfeeding use; flags citrinin and interaction risks.
- **Limitations:** Secondary consumer monograph; not a primary study or systematic review.
- **Population mismatch:** No study population; applies broadly to supplement users.
- **Directness:** same_mechanism clinical safety context

**Why it matters:** Useful for patient-facing safety boundaries and for noting that label/product uncertainty can change both efficacy and risk.

**Potential experiment signals:** LDL-C/total cholesterol context; monacolin K content variability; citrinin contamination; statin-like adverse effects; drug interactions

**Protocol takeaway:** Use as a safety and consumer-communication source, not as a primary efficacy estimate.

**Claim use:** `safety-only`.
