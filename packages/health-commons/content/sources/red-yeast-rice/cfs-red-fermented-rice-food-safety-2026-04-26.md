---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:cfs-red-fermented-rice-food-safety-2026-04-26"
slug: "sources/red-yeast-rice/cfs-red-fermented-rice-food-safety-2026-04-26"
title: "Red Fermented Rice and Food Safety"
summary: "Centre for Food Safety overview noting that red fermented rice/red yeast rice can contain monacolin K and may raise statin-like safety, interaction, and dose-fidelity concerns."
status: "draft"
quality: "usable"
aliases:
  - "Shuk-man Chow 2017: Red Fermented Rice and Food Safety"
  - "Red Fermented Rice and Food Safety"
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
  title: "Red Fermented Rice and Food Safety"
  authors: "Shuk-man Chow; Centre for Food Safety, Government of the Hong Kong Special Administrative Region"
  year: 2017
  journal: "Food Safety Focus / Centre for Food Safety"
  citation: "Shuk-man Chow; Centre for Food Safety, Government of the Hong Kong Special Administrative Region. Red Fermented Rice and Food Safety. Food Safety Focus / Centre for Food Safety. 2017."
  url: "https://www.cfs.gov.hk/english/multimedia/multimedia_pub/multimedia_pub_fsf_126_01.html"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "be5a8099be3f094f54927e5f6c57da765d49414085c501232a36b29e0bbfc2eb"
    url: "https://www.cfs.gov.hk/english/multimedia/multimedia_pub/multimedia_pub_fsf_126_01.html"
  canonicalUrl: "https://www.cfs.gov.hk/english/multimedia/multimedia_pub/multimedia_pub_fsf_126_01.html"
researchEvidence:
  designKind: "other"
  designLabel: "Food-safety explainer"
  populationLabel: "Consumers and red fermented rice / red yeast rice food or supplement products; no human trial cohort"
  durationLabel: "No intervention duration or follow-up"
  aggregateRole: "primary"
  cohortKey: "cfs-red-fermented-rice-food-safety-2026-04-26"
evidenceBucket: "Product quality, contamination, and dose uncertainty"
whyItMatters: "It supports a safety boundary: consumer RYR products can behave like lovastatin exposure, but product monacolin content may not be knowable from ordinary labeling."
potentialMurphEndpoints:
  - "monacolin K dose uncertainty"
  - "citrinin contamination context"
  - "statin-like adverse-event and interaction risk"
  - "consumer labeling / product-quality boundary"
protocolTakeaway: "Use this as consumer-safety context for medical supervision, interaction screening, and product-quality caution, not as lipid-efficacy evidence."
murphTakeaway: "Use this as consumer-safety context for medical supervision, interaction screening, and product-quality caution, not as lipid-efficacy evidence. It should shape product selection, monitoring, dose fidelity, or safety context without being treated as direct LDL-C efficacy evidence."
studyDesign: "Food-safety explainer"
modality: "Red yeast rice supplement quality/safety context"
claimUse: "safety-only"
sourceFindings:
  -
    findingId: "finding:cfs-red-fermented-rice-food-safety-2026-04-26:batch-003-primary"
    sourceKey: "source_artifact:cfs-red-fermented-rice-food-safety-2026-04-26"
    findingKind: "safety"
    population: "Consumers and red fermented rice / red yeast rice food or supplement products; no human trial cohort"
    exposure: "Red fermented rice / red yeast rice products containing Monascus-derived compounds, including possible monacolin K and citrinin"
    outcome: "monacolin K dose uncertainty; citrinin contamination context; statin-like adverse-event and interaction risk; consumer labeling / product-quality boundary"
    summary: "No lipid-effect estimate; the page notes that consumers cannot determine product monacolin K content from typical food-product presentation and that monacolin K is chemically identical to lovastatin."
    evidenceUse:
      - "context"
      - "safety"
murphV1Priority: "Medium"
pdfRightsStatus: "unknown"
---
This source is included for **Product quality, contamination, and dose uncertainty**.

**Findings:** Centre for Food Safety overview noting that red fermented rice/red yeast rice can contain monacolin K and may raise statin-like safety, interaction, and dose-fidelity concerns.

**Extracted details:**

- **Population / sample:** Consumers and red fermented rice / red yeast rice food or supplement products; no human trial cohort
- **Intervention or exposure:** Red fermented rice / red yeast rice products containing Monascus-derived compounds, including possible monacolin K and citrinin
- **Comparator / control:** No comparator; regulatory and food-safety context
- **Duration / follow-up:** No intervention duration or follow-up
- **Endpoints:** monacolin K dose uncertainty; citrinin contamination context; statin-like adverse-event and interaction risk; consumer labeling / product-quality boundary
- **Effect estimates or direction:** No lipid-effect estimate; the page notes that consumers cannot determine product monacolin K content from typical food-product presentation and that monacolin K is chemically identical to lovastatin.
- **Adverse events or safety notes:** Highlights potential liver and muscle side effects and drug interactions for monacolin K/lovastatin-like exposure; cites citrinin as a safety concern.
- **Limitations:** Public food-safety explainer rather than original product testing or clinical efficacy research.
- **Population mismatch:** Not a trial in people using the Murph cholesterol protocol.
- **Directness:** same_mechanism; product-quality and safety boundary for RYR-containing products

**Why it matters:** It supports a safety boundary: consumer RYR products can behave like lovastatin exposure, but product monacolin content may not be knowable from ordinary labeling.

**Potential experiment signals:** monacolin K dose uncertainty; citrinin contamination context; statin-like adverse-event and interaction risk; consumer labeling / product-quality boundary

**Protocol takeaway:** Use this as consumer-safety context for medical supervision, interaction screening, and product-quality caution, not as lipid-efficacy evidence.

**Claim use:** `safety-only`.
