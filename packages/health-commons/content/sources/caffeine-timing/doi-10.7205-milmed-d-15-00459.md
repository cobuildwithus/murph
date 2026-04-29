---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.7205-milmed-d-15-00459
slug: sources/caffeine-timing/doi-10.7205-milmed-d-15-00459
title: Caffeine Content in Popular Energy Drinks and Energy Shots Available for Purchase
summary: Top-selling energy drinks (n=9) and energy shots (n=5) were purchased and analyzed in triplicate; 5 of 14 products did not list caffeine amounts, and the 9 products that did were within 15% of the stated label amount, with stated values ranging 75-240 mg for energy drinks and 31-270 mg for energy shots.
status: draft
quality: usable
aliases:
- Caffeine Content in Popular Energy Drinks and Energy Shots Available for Purchase
- source_artifact:doi-10.7205-milmed-d-15-00459
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: journal_article
  title: Caffeine Content in Popular Energy Drinks and Energy Shots Available for Purchase
  authors: Attipoe S; Leggit J; Deuster PA
  year: 2016
  journal: Military Medicine
  citation: Attipoe S, Leggit J, Deuster PA. Caffeine Content in Popular Energy Drinks and Energy Shots Available for Purchase. Military Medicine. 2016. doi:10.7205/milmed-d-15-00459.
  doi: 10.7205/milmed-d-15-00459
  url: https://academic.oup.com/milmed/article/181/9/1016/4159556
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.7205/milmed-d-15-00459
    titleHash: a0110346759c96f6110d277b8691dcad39caf46fa3c0ccab0d1bf24726cbdfad
    url: https://academic.oup.com/milmed/article/181/9/1016/4159556
  canonicalUrl: https://academic.oup.com/milmed/article/181/9/1016/4159556
researchEvidence:
  designKind: other
  designLabel: Energy drink and energy shot label/content audit
  participantCount: 14
  populationLabel: Top-selling commercial energy drinks and energy shots purchased for caffeine analysis.
  durationLabel: Cross-sectional product-content analysis; no human follow-up or 14-day curfew period.
  aggregateRole: primary
  cohortKey: doi-10-7205-milmed-energy-drinks-shots
  notes:
  - 'Intervention or exposure: Commercial energy drinks and energy shots; three units each for 14 products were analyzed by an independent laboratory.'
  - 'Comparator or control: Declared caffeine amount on product facts panels where available.'
  - 'Endpoints: Measured caffeine content, labeled caffeine disclosure, and label-measurement agreement.'
  - 'Effect or direction: Top-selling energy drinks (n=9) and energy shots (n=5) were tested; 5 of 14 products did not provide caffeine amounts, while the 9 products with stated amounts were within 15% of the label. Labeled values ranged 75-240 mg for energy drinks and 31-270 mg for energy shots.'
  - 'Adverse events or safety notes: No human adverse events were measured; safety relevance is concentrated caffeine exposure and incomplete disclosure.'
  - 'Population mismatch: Directly useful for dose accounting, but it is not an intervention trial of a caffeine curfew.'
  - 'Limitations: U.S. retail product sample from 2013-era products; product counts are small and products may change formulations.'
evidenceBucket: caffeine_source_dose_audit
whyItMatters: Energy shots and energy drinks can carry concentrated caffeine doses and may not always disclose exact mg, so they are high-priority items in a no-caffeine-after-cutoff source audit.
potentialMurphEndpoints:
- daily caffeine dose
- caffeine source fidelity
- caffeinated product after cutoff
- adverse caffeine symptoms
protocolTakeaway: Ask users to log energy drinks and shots by product name, serving size, and label caffeine when available; treat undisclosed proprietary blends as uncertain rather than zero caffeine.
murphTakeaway: A single energy shot may be a major dose event; hidden or undisclosed caffeine should trigger a conservative adherence note.
studyDesign: product_content_analysis
modality: energy-drink-shot-dose-audit
claimUse: supports-protocol
sourceFindings:
- findingId: finding:doi-10.7205-milmed-d-15-00459-energy-drink-shot-dose-audit
  sourceKey: source_artifact:doi-10.7205-milmed-d-15-00459
  extractedFromArtifactId: art_doi_10_7205_milmed_d_15_00459_html
  findingKind: measurement_validation
  population: Top-selling commercial energy drinks and energy shots purchased for caffeine analysis.
  exposure: Commercial energy drinks and energy shots; three units each for 14 products were analyzed by an independent laboratory.
  outcome: Measured caffeine content, labeled caffeine disclosure, and label-measurement agreement.
  summary: Top-selling energy drinks (n=9) and energy shots (n=5) were purchased and analyzed in triplicate; 5 of 14 products did not list caffeine amounts, and the 9 products that did were within 15% of the stated label amount, with stated values ranging 75-240 mg for energy drinks and 31-270 mg for energy shots.
  evidenceUse:
  - measurement
  - safety
murphV1Priority: High
pdfRightsStatus: permission_required
---

This source is included for **caffeine_source_dose_audit**.

**Findings:** Top-selling energy drinks (n=9) and energy shots (n=5) were purchased and analyzed in triplicate; 5 of 14 products did not list caffeine amounts, and the 9 products that did were within 15% of the stated label amount, with stated values ranging 75-240 mg for energy drinks and 31-270 mg for energy shots.

**Why it matters:** Energy shots and energy drinks can carry concentrated caffeine doses and may not always disclose exact mg, so they are high-priority items in a no-caffeine-after-cutoff source audit.

**Potential experiment signals:** daily caffeine dose, caffeine source fidelity, caffeinated product after cutoff, adverse caffeine symptoms.

**Protocol takeaway:** Ask users to log energy drinks and shots by product name, serving size, and label caffeine when available; treat undisclosed proprietary blends as uncertain rather than zero caffeine.

**Claim use:** `supports-protocol`.
