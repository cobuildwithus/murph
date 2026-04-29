---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-highly-concentrated-caffeine-guidance-2018-04-16
slug: sources/caffeine-timing/fda-highly-concentrated-caffeine-guidance-2018-04-16
title: 'Guidance for Industry: Highly Concentrated Caffeine in Dietary Supplements'
summary: FDA guidance landing page for the 2018 highly concentrated caffeine supplement safety boundary.
status: draft
quality: usable
aliases:
- FDA guidance landing page highly concentrated caffeine
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: guideline
  title: 'Guidance for Industry: Highly Concentrated Caffeine in Dietary Supplements'
  authors: U.S. Food and Drug Administration
  year: 2018
  journal: FDA guidance webpage
  citation: 'U.S. Food and Drug Administration. Guidance for Industry: Highly Concentrated Caffeine in Dietary Supplements. Current as of April 16, 2018.'
  url: https://www.fda.gov/regulatory-information/search-fda-guidance-documents/guidance-industry-highly-concentrated-caffeine-dietary-supplements
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: 54cdc8920ba4a8f284c6dccbf4ef3ebff330f966bea0457d7db52d14a17264ff
    url: https://www.fda.gov/regulatory-information/search-fda-guidance-documents/guidance-industry-highly-concentrated-caffeine-dietary-supplements
  canonicalUrl: https://www.fda.gov/regulatory-information/search-fda-guidance-documents/guidance-industry-highly-concentrated-caffeine-dietary-supplements
researchEvidence:
  designKind: guideline
  designLabel: FDA guidance landing page
  populationLabel: Dietary supplement firms and consumers
  durationLabel: Regulatory guidance context
  aggregateRole: primary
  cohortKey: fda-highly-concentrated-caffeine-guidance-2018-04-16
evidenceBucket: clinical_safety_boundaries
whyItMatters: This companion landing page helps protocol language distinguish ordinary beverages from caffeine-only supplement products that may be unsafe.
potentialMurphEndpoints:
- biomarker:caffeine-dose
- biomarker:adverse-events
protocolTakeaway: 'Use for product-exclusion language: do not implement the reset with caffeine powders, concentrates, or caffeine-only supplement dosing.'
murphTakeaway: Useful regulatory context source for product-form safety boundaries.
studyDesign: FDA guidance landing page
modality: caffeine safety boundary
claimUse: safety-only
limitations:
- Landing page/guidance; not clinical trial evidence.
populationMismatch: Regulatory product class differs from typical protocol beverage users.
directnessToProtocol: general_guideline
sourceFindings:
- findingId: finding:fda-highly-concentrated-caffeine-guidance-2018-04-16-01
  sourceKey: source_artifact:fda-highly-concentrated-caffeine-guidance-2018-04-16
  extractedFromArtifactId: art_fda_highly_concentrated_caffeine_guidance_2018_04_16_html
  findingKind: safety
  population: Dietary supplement firms and consumers
  exposure: Products consisting only or primarily of caffeine
  outcome: Regulatory adulteration/public-health boundary
  summary: The FDA guidance webpage states that dietary supplements consisting only or primarily of pure or highly concentrated caffeine have been linked to deaths and may present a significant public-health threat.
  evidenceUse:
  - safety
- findingId: finding:fda-highly-concentrated-caffeine-guidance-2018-04-16-02
  sourceKey: source_artifact:fda-highly-concentrated-caffeine-guidance-2018-04-16
  extractedFromArtifactId: art_fda_highly_concentrated_caffeine_guidance_2018_04_16_html
  findingKind: context
  population: Protocol authors and product auditors
  exposure: FDA nonbinding guidance
  outcome: Boundary between ordinary caffeine sources and dangerous supplement forms
  summary: The webpage frames the guidance as FDA's current thinking and a regulatory boundary for caffeine-only or primarily caffeine products, not a blanket prohibition on ordinary caffeinated foods or beverages.
  evidenceUse:
  - context
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **clinical_safety_boundaries**.

**Findings:**
- `finding:fda-highly-concentrated-caffeine-guidance-2018-04-16-01`: The FDA guidance webpage states that dietary supplements consisting only or primarily of pure or highly concentrated caffeine have been linked to deaths and may present a significant public-health threat.
- `finding:fda-highly-concentrated-caffeine-guidance-2018-04-16-02`: The webpage frames the guidance as FDA's current thinking and a regulatory boundary for caffeine-only or primarily caffeine products, not a blanket prohibition on ordinary caffeinated foods or beverages.

**Why it matters:** This companion landing page helps protocol language distinguish ordinary beverages from caffeine-only supplement products that may be unsafe.

**Potential experiment signals:**
- biomarker:caffeine-dose
- biomarker:adverse-events

**Protocol takeaway:** Use for product-exclusion language: do not implement the reset with caffeine powders, concentrates, or caffeine-only supplement dosing.

**Claim use:** `safety-only`.
