---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-currentbody-series-2-k250966-2025-06-25
slug: sources/skin-photobiomodulation/fda-currentbody-series-2-k250966-2025-06-25
title: 510(k) Summary: CurrentBody Skin LED Light Therapy Mask Series 2, Model MK-90H
summary: FDA 510(k) summary for a home-use red/NIR LED wrinkle mask documenting wavelengths, dose, schedule, auto shutoff, and eye inserts.
status: draft
quality: usable
categories:
  - skin-photobiomodulation
relations:
  -
    type: related_protocol
    target: protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging
  -
    type: parent_family
    target: experiment_family:skin-photobiomodulation
source:
  kind: web_page
  title: 510(k) Summary: CurrentBody Skin LED Light Therapy Mask Series 2, Model MK-90H
  authors: U.S. Food and Drug Administration; Shenzhen Kaiyan Medical Equipment Co., Ltd.
  year: 2025
  journal: FDA 510(k) Premarket Notification
  citation: U.S. Food and Drug Administration. 510(k) Summary: CurrentBody Skin LED Light Therapy Mask Series 2, Model MK-90H (K250966). Decision date June 25, 2025.
  url: https://www.accessdata.fda.gov/cdrh_docs/pdf25/K250966.pdf
researchEvidence:
  designKind: other
  designLabel: FDA 510(k) summary and nonclinical performance documentation
  populationLabel: OTC users of a home-use wearable LED mask indicated for full-face wrinkles
  durationLabel: 10 minutes per treatment, 5 times weekly for 6 weeks in device summary
  aggregateRole: context
  cohortKey: fda-currentbody-series-2-k250966-2025-06-25
evidenceBucket: eye and face-adjacent ocular safety boundary
whyItMatters: It is directly adjacent to the protocol device class and records eye inserts as part of the cleared device configuration.
potentialMurphEndpoints:
  - session duration
  - weekly frequency
  - eye insert use
  - auto shutoff
  - dose
protocolTakeaway: Use as safety-only or context-only evidence; do not use for direct skin-outcome claims.
murphTakeaway: Treat new eye symptoms during facial light use as stop-use signals.
studyDesign: FDA 510(k) summary and nonclinical performance documentation
modality: 633 nm red and 830 nm near-infrared LED mask
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **eye and face-adjacent ocular safety boundary**.

**Findings:** The summary describes 633 nm and 830 nm LEDs, 30 mW/cm² total intensity, 18 J/cm² dose, 10-minute sessions, 5 sessions weekly for 6 weeks, auto shutoff, and a pair of eye inserts.

**Why it matters:** It is directly adjacent to the protocol device class and records eye inserts as part of the cleared device configuration.

**Potential experiment signals:** session duration, weekly frequency, eye insert use, auto shutoff, dose.

**Protocol takeaway:** Use as safety-only or context-only evidence; do not use for direct skin-outcome claims.

**Claim use:** `safety-only`.
