---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-pulse-oximeter-skin-tone-guidance-2025
slug: sources/spo2/fda-pulse-oximeter-skin-tone-guidance-2025
title: "FDA draft recommendations to improve pulse oximeter performance across skin tones"
summary: "FDA 2025 announcement describing draft recommendations intended to improve pulse-oximeter performance across people with different skin pigmentation."
status: field-testing
quality: usable
categories:
  - spo2
  - pulse-oximetry
  - device-accuracy
  - skin-pigmentation
  - health-equity
relations:

  -
    type: measures
    target: biomarker:blood-oxygen-spo2
source:
  kind: web_page
  title: "FDA Proposes Updated Recommendations to Help Improve Performance of Pulse Oximeters Across Skin Tones"
  authors: "U.S. Food and Drug Administration"
  year: 2025
  journal: "FDA News Release"
  citation: "U.S. Food and Drug Administration. FDA Proposes Updated Recommendations to Help Improve Performance of Pulse Oximeters Across Skin Tones. FDA News Release. 2025-01-06."
  url: https://www.fda.gov/news-events/press-announcements/fda-proposes-updated-recommendations-help-improve-performance-pulse-oximeters-across-skin-tones
researchEvidence:
  designKind: guideline
  designLabel: "Regulatory draft-guidance announcement"
  populationLabel: "People using pulse oximeters across diverse skin pigmentation"
  aggregateRole: context
evidenceBucket: "Skin-pigmentation accuracy caveat"
whyItMatters: "Prevents Murph from presenting pulse-oximeter readings as equally reliable across all users without a device-accuracy caveat."
potentialMurphEndpoints:
  - SpO₂ trend interpretation
  - device-limit explanations
  - health-equity caveats
murphTakeaway: "SpO₂ pages and trend cards should explicitly mention skin-pigmentation performance differences and avoid overconfident clinical interpretation."
studyDesign: "Regulatory draft-guidance announcement"
modality: "Pulse oximetry device performance"
murphV1Priority: High
---

This FDA announcement supports the skin-pigmentation caveat on the SpO₂ biomarker page.

Murph should not imply that all pulse-oximeter or wearable readings have identical accuracy across all people. The practical product-language consequence is simple: trends are useful, but the device class and known accuracy limitations should stay visible.
