---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:nccih-high-cholesterol-natural-products-2026-04-25"
slug: "sources/red-yeast-rice/nccih-high-cholesterol-natural-products-2026-04-25"
title: "High Cholesterol and Natural Products: What the Science Says"
summary: "NCCIH clinician digest noting that red yeast rice with substantial monacolin K may lower cholesterol but raises FDA legality, statin-like adverse effect, interaction, and citrinin concerns."
status: "draft"
quality: "usable"
aliases:
  - "NCCIH high cholesterol natural products red yeast rice"
categories:
  - "red-yeast-rice"
  - "regulatory"
  - "safety"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "web_page"
  title: "High Cholesterol and Natural Products: What the Science Says"
  authors: "National Center for Complementary and Integrative Health"
  year: 2026
  journal: "NCCIH"
  citation: "National Center for Complementary and Integrative Health. High Cholesterol and Natural Products: What the Science Says. NCCIH. Accessed 2026."
  url: "https://www.nccih.nih.gov/health/providers/digest/high-cholesterol-and-natural-products-science"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "60e63d931251ed22a94182a7e7c590f9886da61b4a5a14661c877d0fa96e8533"
    url: "https://www.nccih.nih.gov/health/providers/digest/high-cholesterol-and-natural-products-science"
  canonicalUrl: "https://www.nccih.nih.gov/health/providers/digest/high-cholesterol-and-natural-products-science"
researchEvidence:
  designKind: "narrative_review"
  designLabel: "Evidence digest / narrative review"
  populationLabel: "People considering natural products for high cholesterol and clinicians counseling them."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "nccih-high-cholesterol-natural-products-2026-04-25"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Provides a balanced public-health boundary: efficacy depends on monacolin content, but the same content creates legal and safety concerns."
potentialMurphEndpoints:
  - "LDL-C"
  - "total cholesterol"
  - "monacolin K content"
  - "muscle symptoms"
  - "kidney-safety symptoms"
protocolTakeaway: "Do not claim benefit for low/unknown monacolin products; substantial monacolin exposure must be handled as drug-like safety context."
murphTakeaway: "A red yeast rice experiment requires monacolin-content documentation and safety monitoring; otherwise both benefit and risk are ambiguous."
studyDesign: "Evidence digest / narrative review"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:

  -
    findingKind: "context"
    population: "People considering natural products for high cholesterol"
    exposure: "Red yeast rice products with varying monacolin K content"
    outcome: "Efficacy/safety boundary for cholesterol use"
    summary: "NCCIH summarizes that red yeast rice products with substantial monacolin K may lower total cholesterol and LDL-C but can be illegal as supplements in the U.S. and can carry lovastatin-like side effects, interactions, and citrinin kidney-risk concerns; products with little or no monacolin K have unknown effectiveness."
    evidenceUse:
      - "efficacy"
      - "safety"
      - "context"
    findingId: "finding:nccih-high-cholesterol-natural-products-2026-04-25-nccih-high-cholesterol-context"
    sourceKey: "source_artifact:nccih-high-cholesterol-natural-products-2026-04-25"
    extractedFromArtifactId: "art_nccih_high_cholesterol_natural_products_2026_04_25_html"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
artifacts:

  -
    artifactId: "art_nccih_high_cholesterol_natural_products_2026_04_25_html"
    sourceKey: "source_artifact:nccih-high-cholesterol-natural-products-2026-04-25"
    kind: "html"
    storage: "external"
    sourceUrl: "https://www.nccih.nih.gov/health/providers/digest/high-cholesterol-and-natural-products-science"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "People considering natural products for high cholesterol and clinicians counseling them."
  interventionOrExposure: "Red yeast rice products with varying monacolin K content."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "LDL-C and total cholesterol context"
    - "FDA legality"
    - "statin-like adverse effects"
    - "citrinin contamination"
  effectEstimatesOrDirection: "NCCIH states trials of products with substantial monacolin K lowered total cholesterol and LDL-C, while products with little or no monacolin K have not been studied and their effectiveness is unknown."
  adverseEventsOrSafetyNotes: "Substantial monacolin K may cause lovastatin-like side effects and interactions; citrinin contamination can damage kidneys."
  limitations: "Narrative government digest; not a new primary trial and groups products by monacolin content."
  populationMismatch: "Regulatory, product-quality, or safety context; not a Murph self-experiment cohort."
  directnessToProtocol: "general_guideline"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** NCCIH clinician digest noting that red yeast rice with substantial monacolin K may lower cholesterol but raises FDA legality, statin-like adverse effect, interaction, and citrinin concerns.

**Why it matters:** Provides a balanced public-health boundary: efficacy depends on monacolin content, but the same content creates legal and safety concerns.

**Potential experiment signals:** LDL-C, total cholesterol, monacolin K content, muscle symptoms, kidney-safety symptoms.

**Protocol takeaway:** Do not claim benefit for low/unknown monacolin products; substantial monacolin exposure must be handled as drug-like safety context.

**Claim use:** `safety-only`.
