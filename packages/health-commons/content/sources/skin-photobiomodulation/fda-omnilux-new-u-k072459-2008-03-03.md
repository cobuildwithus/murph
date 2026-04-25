---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-omnilux-new-u-k072459-2008-03-03
slug: sources/skin-photobiomodulation/fda-omnilux-new-u-k072459-2008-03-03
title: 510(k) Summary: Omnilux New-U
summary: FDA 510(k) device-summary context for an OTC red/NIR home-use periorbital wrinkle device; useful for wavelength, intended-use, and eye-safety boundaries, not as a clinical efficacy trial.
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
  title: 510(k) Summary: Omnilux New-U
  authors: U.S. Food and Drug Administration; Photo Therapeutics Inc.
  year: 2008
  journal: FDA 510(k) Premarket Notification
  citation: U.S. Food and Drug Administration; Photo Therapeutics Inc. 510(k) Summary: Omnilux New-U. FDA 510(k) Premarket Notification; 2008. K072459.
  url: https://www.accessdata.fda.gov/cdrh_docs/pdf7/K072459.pdf
researchEvidence:
  designKind: other
  designLabel: FDA 510(k) summary; no primary clinical efficacy extraction
  populationLabel: Over-the-counter home users seeking periorbital wrinkle reduction; no extracted clinical cohort from the 510(k) summary.
  durationLabel: Device-use context only; clinical follow-up not extracted from this regulatory summary.
  aggregateRole: context
  cohortKey: fda-omnilux-new-u-2008
protocolEvidence:
  -
    protocolKey: protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging
    groupId: fda-omnilux-new-u-2008
    stance: context_only
    scope: direct_protocol
    result: not_efficacy_evidence
    headline: Early OTC periorbital wrinkle device cleared with red and near-infrared LEDs.
    implication: Use this as device-implementation context for wavelengths and intended-use framing, not as proof of skin-texture or photoaging benefit.
    caveat: FDA 510(k) substantial-equivalence summaries are regulatory device records and should not be counted as standalone human efficacy trials.
    displayPriority: 40
evidenceBucket: regulatory and consumer-device implementation context
whyItMatters: Anchors a historically important home-use red/NIR wrinkle device and clarifies that regulatory clearance is different from protocol efficacy evidence.
potentialMurphEndpoints:
  - consumer-device-dose
  - wavelength-band
  - eye-protection
  - intended-use-labeling
protocolTakeaway: Treat Omnilux New-U as context for red 633 nm and NIR 830 nm periocular wrinkle-device implementation, not as a direct outcome source.
murphTakeaway: Helpful for comparing consumer-device wavelength choices and periocular safety language; do not promote to an efficacy claim.
studyDesign: Regulatory 510(k) summary for an OTC light-based wrinkle-reduction device.
modality: Home-use red/NIR LED wrinkle device
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **regulatory and consumer-device implementation context**.

**Findings:** The source describes an OTC Omnilux New-U device for periorbital wrinkles using red 633±6 nm and infrared 830±5 nm modes. It is included for device parameters, intended-use labeling, and safety-boundary context only.

**Why it matters:** Anchors a historically important home-use red/NIR wrinkle device and clarifies that regulatory clearance is different from protocol efficacy evidence.

**Potential experiment signals:** Wavelength band, intended treatment area, OTC/home-use status, periocular cautions, and regulatory predicate language.

**Protocol takeaway:** Treat Omnilux New-U as context for red 633 nm and NIR 830 nm periocular wrinkle-device implementation, not as a direct outcome source.

**Claim use:** `context-only`.
