---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-wrinkle-retreat-pro-k252983-2025-12-17
slug: sources/skin-photobiomodulation/fda-wrinkle-retreat-pro-k252983-2025-12-17
title: 510(k) Summary: Wrinkle Retreat Pro Light Therapy Face Mask
summary: FDA 510(k) context for a recent OTC full-face wrinkle mask using amber, red, deep-red, and NIR LEDs with built-in eye shielding and auto-shutoff.
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
  kind: other
  title: 510(k) Summary: Wrinkle Retreat Pro Light Therapy Face Mask
  authors: U.S. Food and Drug Administration; Shenzhen Goodwind Technology Development Co., Ltd.
  year: 2025
  journal: FDA 510(k) Premarket Notification
  citation: U.S. Food and Drug Administration; Shenzhen Goodwind Technology Development Co., Ltd. 510(k) Summary: Wrinkle Retreat Pro Light Therapy Face Mask. FDA 510(k) Premarket Notification; 2025. K252983.
  url: https://www.accessdata.fda.gov/cdrh_docs/pdf25/K252983.pdf
researchEvidence:
  designKind: other
  designLabel: FDA 510(k) summary; recent consumer-mask device parameters
  populationLabel: Over-the-counter users seeking full-face wrinkle treatment; no extracted clinical cohort from the regulatory summary.
  durationLabel: Device summary describes a 3-minute treatment with automatic shutoff; clinical follow-up not extracted.
  aggregateRole: context
  cohortKey: fda-wrinkle-retreat-pro-2025
evidenceBucket: regulatory and consumer-device implementation context
whyItMatters: Anchors modern consumer-mask features such as multiple wavelengths, short treatment time, protective eye shield, rechargeable controller, and auto shutoff.
potentialMurphEndpoints:
  - consumer-device-dose
  - session-length
  - multi-wavelength-device
  - eye-shield
  - auto-shutoff
protocolTakeaway: Use as a recent device-implementation boundary for multi-wavelength LED masks; do not treat as clinical outcome evidence.
murphTakeaway: Helpful for practical device-design context and for distinguishing FDA-cleared device labels from trial-proven protocol effects.
studyDesign: Regulatory 510(k) summary for an OTC full-face wrinkle LED mask.
modality: Amber/red/deep-red/NIR LED face mask
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **regulatory and consumer-device implementation context**.

**Findings:** The source describes a full-face OTC wrinkle mask using amber 605±5 nm, red 630±5 nm, red/deep-red 660±5 nm, and NIR 830±5 nm LEDs, with total intensity around 65 mW/cm², 320 LEDs, a 3-minute treatment, protective eye-shielding, and auto shutoff.

**Why it matters:** Anchors modern consumer-mask features such as multiple wavelengths, short treatment time, protective eye shield, rechargeable controller, and auto shutoff.

**Potential experiment signals:** Multi-wavelength consumer-mask design, treatment duration, power-density context, eye shield, and stop/auto-shutoff features.

**Protocol takeaway:** Use as a recent device-implementation boundary for multi-wavelength LED masks; do not treat as clinical outcome evidence.

**Claim use:** `context-only`.
