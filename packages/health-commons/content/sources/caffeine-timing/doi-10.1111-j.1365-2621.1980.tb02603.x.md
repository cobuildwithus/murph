---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1111-j.1365-2621.1980.tb02603.x
slug: sources/caffeine-timing/doi-10.1111-j.1365-2621.1980.tb02603.x
title: Theobromine and caffeine content of chocolate products
summary: 'Commercial chocolate and cocoa products contained measurable caffeine: chocolate liquor and commercial cocoas averaged 0.21% caffeine, sweet chocolate averaged 0.07%, milk chocolate averaged 0.02%, hot cocoa beverages averaged 4 mg caffeine per 5-ounce serving, and chocolate milk averaged 5 mg per 8-ounce serving.'
status: draft
quality: usable
aliases:
- Theobromine and caffeine content of chocolate products
- source_artifact:doi-10.1111-j.1365-2621.1980.tb02603.x
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: journal_article
  title: Theobromine and caffeine content of chocolate products
  authors: Zoumas BL; Kreiser WR; Martin RA
  year: 1980
  journal: Journal of Food Science
  citation: Zoumas BL, Kreiser WR, Martin RA. Theobromine and caffeine content of chocolate products. Journal of Food Science. 1980. doi:10.1111/j.1365-2621.1980.tb02603.x.
  doi: 10.1111/j.1365-2621.1980.tb02603.x
  url: https://ift.onlinelibrary.wiley.com/doi/abs/10.1111/j.1365-2621.1980.tb02603.x
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1111/j.1365-2621.1980.tb02603.x
    titleHash: ce335857a9cf70ac4477fcf686439714495b4355e8c55b19488870dced9745db
    url: https://ift.onlinelibrary.wiley.com/doi/abs/10.1111/j.1365-2621.1980.tb02603.x
  canonicalUrl: https://ift.onlinelibrary.wiley.com/doi/abs/10.1111/j.1365-2621.1980.tb02603.x
researchEvidence:
  designKind: other
  designLabel: Theobromine and caffeine content analysis of chocolate products
  populationLabel: Commercial chocolate, cocoa, and chocolate beverage products.
  durationLabel: Cross-sectional product-content analysis; no human follow-up.
  aggregateRole: context
  cohortKey: doi-10-1111-chocolate-theobromine-caffeine
  notes:
  - 'Intervention or exposure: Commercial chocolate products, cocoas, hot cocoa beverages, and chocolate milk prepared from cocoa-sugar mixes.'
  - 'Comparator or control: Chocolate and cocoa product categories.'
  - 'Endpoints: Theobromine and caffeine percent/content by product category and beverage serving.'
  - 'Effect or direction: Commercial chocolate products were analyzed by HPLC. Chocolate liquor samples averaged 1.22% theobromine and 0.21% caffeine; commercial cocoas averaged 1.89% theobromine and 0.21% caffeine; sweet chocolate averaged 0.46% theobromine and 0.07% caffeine; milk chocolate averaged 0.15% theobromine and 0.02% caffeine; hot cocoa beverages averaged 4 mg caffeine per 5-ounce serving and chocolate milk averaged 5 mg per 8-ounce serving.'
  - 'Adverse events or safety notes: No human adverse events; relevance is small but nonzero caffeine contribution from chocolate/cocoa sources.'
  - 'Population mismatch: Source-dose context only; no curfew intervention.'
  - 'Limitations: Older chocolate product analysis; product formulations and serving sizes may vary.'
evidenceBucket: caffeine_source_dose_audit
whyItMatters: Chocolate/cocoa should not be called caffeine-free, but its typical caffeine contribution is usually smaller than coffee/energy products.
potentialMurphEndpoints:
- daily caffeine dose
- hidden caffeine source count
- food caffeine estimate
protocolTakeaway: Count chocolate/cocoa as possible low-dose caffeine sources, while keeping their contribution proportionate to beverage and supplement doses.
murphTakeaway: A late chocolate snack may be a small caffeine exposure; it is usually not equivalent to a coffee unless the product/amount is unusual.
studyDesign: chocolate_content_analysis
modality: chocolate-cocoa-caffeine-context
claimUse: context-only
sourceFindings:
- findingId: finding:doi-10.1111-j.1365-2621.1980.tb02603.x-chocolate-cocoa-caffeine-context
  sourceKey: source_artifact:doi-10.1111-j.1365-2621.1980.tb02603.x
  extractedFromArtifactId: art_doi_10_1111_j_1365_2621_1980_tb02603_x_html
  findingKind: context
  population: Commercial chocolate, cocoa, and chocolate beverage products.
  exposure: Commercial chocolate products, cocoas, hot cocoa beverages, and chocolate milk prepared from cocoa-sugar mixes.
  outcome: Theobromine and caffeine percent/content by product category and beverage serving.
  summary: 'Commercial chocolate and cocoa products contained measurable caffeine: chocolate liquor and commercial cocoas averaged 0.21% caffeine, sweet chocolate averaged 0.07%, milk chocolate averaged 0.02%, hot cocoa beverages averaged 4 mg caffeine per 5-ounce serving, and chocolate milk averaged 5 mg per 8-ounce serving.'
  evidenceUse:
  - measurement
  - context
murphV1Priority: Medium
pdfRightsStatus: permission_required
---

This source is included for **caffeine_source_dose_audit**.

**Findings:** Commercial chocolate and cocoa products contained measurable caffeine: chocolate liquor and commercial cocoas averaged 0.21% caffeine, sweet chocolate averaged 0.07%, milk chocolate averaged 0.02%, hot cocoa beverages averaged 4 mg caffeine per 5-ounce serving, and chocolate milk averaged 5 mg per 8-ounce serving.

**Why it matters:** Chocolate/cocoa should not be called caffeine-free, but its typical caffeine contribution is usually smaller than coffee/energy products.

**Potential experiment signals:** daily caffeine dose, hidden caffeine source count, food caffeine estimate.

**Protocol takeaway:** Count chocolate/cocoa as possible low-dose caffeine sources, while keeping their contribution proportionate to beverage and supplement doses.

**Claim use:** `context-only`.
