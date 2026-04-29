---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-light-tree-led-mask-k221946-2022-11-22
slug: sources/skin-photobiomodulation/fda-light-tree-led-mask-k221946-2022-11-22
title: '510(k) Summary: LED Light Therapy Mask, Model MK66R-B'
summary: FDA 510(k) context for a full-face OTC red/NIR LED mask, including wavelength, intensity, treatment-time, and label-use details; not clinical efficacy evidence.
status: draft
quality: usable
aliases:
- LED Light Therapy Mask Model MK66R-B
- K221946
- Light Tree Ventures LED mask
categories:
- skin-photobiomodulation
relations:
- type: related_protocol
  target: protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging
- type: parent_family
  target: experiment_family:skin-photobiomodulation
source:
  kind: other
  title: '510(k) Summary: LED Light Therapy Mask, Model MK66R-B'
  authors: U.S. Food and Drug Administration; Light Tree Ventures Europe B.V.
  year: 2022
  journal: FDA 510(k) Premarket Notification
  citation: 'U.S. Food and Drug Administration; Light Tree Ventures Europe B.V. 510(k) Summary: LED Light Therapy Mask, Model MK66R-B. FDA 510(k) Premarket Notification; 2022. K221946.'
  url: https://www.accessdata.fda.gov/cdrh_docs/pdf22/K221946.pdf
researchEvidence:
  designKind: other
  designLabel: FDA 510(k) summary; consumer-mask device parameters
  populationLabel: Over-the-counter users seeking full-face wrinkle treatment; no extracted clinical cohort from the regulatory summary.
  durationLabel: Device labeling context reports 10-minute treatments, five times weekly for six weeks; no independent efficacy follow-up extracted.
  aggregateRole: context
  cohortKey: fda-light-tree-mask-2022
evidenceBucket: regulatory and consumer-device implementation context
whyItMatters: Provides a concrete consumer-mask implementation profile near common red/NIR protocol ranges while preserving the regulatory/evidence boundary.
potentialMurphEndpoints:
- consumer-device-dose
- session-length
- weekly-frequency
- cumulative-dose
- eye-protection
protocolTakeaway: Use as context for a 630/830 nm OTC full-face mask schedule and power-density range; do not cite as direct clinical outcome evidence.
murphTakeaway: Good device-parameter anchor for consumer masks, especially 10-minute sessions and cumulative-dose framing.
studyDesign: Regulatory 510(k) summary comparing an OTC wrinkle mask with predicate devices.
modality: Full-face red/NIR LED mask
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **regulatory and consumer-device implementation context**.

**Findings:** The source describes an OTC full-face wrinkle mask with red 630±5 nm and NIR 830 nm LEDs, total intensity around 30 mW/cm², and a labeled 10-minute, five-times-weekly, six-week treatment course. It is device-implementation context, not clinical efficacy evidence.

**Why it matters:** Provides a concrete consumer-mask implementation profile near common red/NIR protocol ranges while preserving the regulatory/evidence boundary.

**Potential experiment signals:** Wavelengths, power density, session length, weekly frequency, cumulative dose, LED count, and eye-protection assumptions.

**Protocol takeaway:** Use as context for a 630/830 nm OTC full-face mask schedule and power-density range; do not cite as direct clinical outcome evidence.

**Claim use:** `context-only`.
