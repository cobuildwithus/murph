---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1016-j.foodcont.2013.10.016"
slug: "sources/red-yeast-rice/doi-10.1016-j.foodcont.2013.10.016"
title: "Incidence of citrinin in red yeast rice and various commercial Monascus products in Taiwan from 2009 to 2012"
summary: "Analytical survey of 302 Taiwan samples reporting category-specific citrinin incidence and concentrations in red yeast rice and Monascus products."
status: "draft"
quality: "usable"
aliases:
  - "Liao CD 2014: Incidence of citrinin in red yeast rice and various commercial Monascus products in Taiwan from 2009 to 2012"
  - "DOI 10.1016/j.foodcont.2013.10.016"
  - "Incidence of citrinin in red yeast rice and various commercial Monascus products in Taiwan from 2009 to 2012"
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
  kind: "journal_article"
  title: "Incidence of citrinin in red yeast rice and various commercial Monascus products in Taiwan from 2009 to 2012"
  authors: "Liao CD; Chen YC; Lin HY; Chiueh LC; Shih DYC"
  year: 2014
  journal: "Food Control"
  citation: "Liao CD; Chen YC; Lin HY; Chiueh LC; Shih DYC. Incidence of citrinin in red yeast rice and various commercial Monascus products in Taiwan from 2009 to 2012. Food Control. 2014. doi:10.1016/j.foodcont.2013.10.016."
  doi: "10.1016/j.foodcont.2013.10.016"
  url: "https://doi.org/10.1016/j.foodcont.2013.10.016"
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.1016/j.foodcont.2013.10.016"
    titleHash: "031f4db1464b3ee9081c68290f9a4a7ab71fd261a5c92ea415d4c9d7b47ffe37"
    url: "https://doi.org/10.1016/j.foodcont.2013.10.016"
  canonicalUrl: "https://doi.org/10.1016/j.foodcont.2013.10.016"
researchEvidence:
  designKind: "other"
  designLabel: "Analytical market-survey for citrinin"
  populationLabel: "302 red yeast rice, dietary supplement, and processed Monascus-product samples in Taiwan from 2009 to 2012"
  durationLabel: "Cross-sectional product testing across 2009-2012 sample period"
  aggregateRole: "primary"
  cohortKey: "doi-10-1016-j-foodcont-2013-10-016"
  participantCount: 302
  participantCountKind: "reported"
evidenceBucket: "Product quality, contamination, and dose uncertainty"
whyItMatters: "Shows that contamination can vary by product type and market context, which constrains implementation and product-selection claims."
potentialMurphEndpoints:
  - "citrinin incidence by product category"
  - "citrinin concentration"
  - "method validation metrics"
protocolTakeaway: "Use as a contamination-quality boundary; do not use to estimate LDL-C response."
murphTakeaway: "Use as a contamination-quality boundary; do not use to estimate LDL-C response. It should shape product selection, monitoring, dose fidelity, or safety context without being treated as direct LDL-C efficacy evidence."
studyDesign: "Analytical market-survey for citrinin"
modality: "Red yeast rice supplement quality/safety context"
claimUse: "safety-only"
sourceFindings:

  -
    findingId: "finding:doi-10-1016-j-foodcont-2013-10-016:batch-003-primary"
    sourceKey: "source_artifact:doi-10.1016-j.foodcont.2013.10.016"
    findingKind: "measurement_validation"
    population: "302 red yeast rice, dietary supplement, and processed Monascus-product samples in Taiwan from 2009 to 2012"
    exposure: "Commercial red yeast rice and related Monascus products analyzed for citrinin contamination"
    outcome: "citrinin incidence by product category; citrinin concentration; method validation metrics"
    summary: "Citrinin incidence was reported as 69.0% in raw red yeast rice, 35.1% in dietary supplements, and 5.7% in processed products; mean contamination levels were reported as 13.3, 1.2, and 0.1 mg/kg, respectively."
    evidenceUse:
      - "measurement"
      - "safety"
murphV1Priority: "Medium"
pdfRightsStatus: "permission_required"
---
This source is included for **Product quality, contamination, and dose uncertainty**.

**Findings:** Analytical survey of 302 Taiwan samples reporting category-specific citrinin incidence and concentrations in red yeast rice and Monascus products.

**Extracted details:**

- **Population / sample:** 302 red yeast rice, dietary supplement, and processed Monascus-product samples in Taiwan from 2009 to 2012
- **Intervention or exposure:** Commercial red yeast rice and related Monascus products analyzed for citrinin contamination
- **Comparator / control:** No clinical comparator; categories of product type compared analytically
- **Duration / follow-up:** Cross-sectional product testing across 2009-2012 sample period
- **Endpoints:** citrinin incidence by product category; citrinin concentration; method validation metrics
- **Effect estimates or direction:** Citrinin incidence was reported as 69.0% in raw red yeast rice, 35.1% in dietary supplements, and 5.7% in processed products; mean contamination levels were reported as 13.3, 1.2, and 0.1 mg/kg, respectively.
- **Adverse events or safety notes:** Citrinin is a nephrotoxic mycotoxin; high contamination rates/levels are relevant to RYR safety screening.
- **Limitations:** Taiwan 2009-2012 market samples may not represent current products or other jurisdictions; analytical survey only.
- **Population mismatch:** Product samples only, not human cholesterol outcomes.
- **Directness:** same_mechanism; directly about RYR product contamination but not protocol efficacy

**Why it matters:** Shows that contamination can vary by product type and market context, which constrains implementation and product-selection claims.

**Potential experiment signals:** citrinin incidence by product category; citrinin concentration; method validation metrics

**Protocol takeaway:** Use as a contamination-quality boundary; do not use to estimate LDL-C response.

**Claim use:** `safety-only`.
