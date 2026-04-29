---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-anti-wrinkle-light-k092800-2010-01-15
slug: sources/skin-photobiomodulation/fda-anti-wrinkle-light-k092800-2010-01-15
title: '510(k) Summary: Anti-Wrinkle Light, Model AAL'
summary: FDA 510(k) context for an older handheld periocular anti-wrinkle LED device; useful for historical consumer-device and periocular boundaries only.
status: draft
quality: usable
aliases:
- Anti-Wrinkle Light Model AAL
- K092800
- LED Intellectual Properties Anti-Wrinkle Light
categories:
- skin-photobiomodulation
relations:
- type: related_protocol
  target: protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging
- type: parent_family
  target: experiment_family:skin-photobiomodulation
source:
  kind: other
  title: '510(k) Summary: Anti-Wrinkle Light, Model AAL'
  authors: U.S. Food and Drug Administration; LED Intellectual Properties LLC
  year: 2010
  journal: FDA 510(k) Premarket Notification
  citation: 'U.S. Food and Drug Administration; LED Intellectual Properties LLC. 510(k) Summary: Anti-Wrinkle Light, Model AAL. FDA 510(k) Premarket Notification; 2010. K092800.'
  url: https://www.accessdata.fda.gov/cdrh_docs/pdf9/K092800.pdf
researchEvidence:
  designKind: other
  designLabel: FDA 510(k) summary; handheld periocular wrinkle device
  populationLabel: Over-the-counter users seeking periorbital wrinkle/rhytide treatment; no extracted clinical cohort from the regulatory summary.
  durationLabel: Device-use context reports a user-controlled 3-minute treatment; clinical follow-up not extracted.
  aggregateRole: context
  cohortKey: fda-anti-wrinkle-light-2010
evidenceBucket: regulatory and consumer-device implementation context
whyItMatters: Frames early handheld anti-wrinkle LED device designs and reinforces the need for periocular-use caution.
potentialMurphEndpoints:
- periocular-boundary
- session-length
- wavelength-band
- eye-protection
protocolTakeaway: Use as historical device context for periocular use and wavelength mix; do not use as a clinical outcome source.
murphTakeaway: Useful for device taxonomy and periocular caution language, lower priority than recent mask records.
studyDesign: Regulatory 510(k) summary for a handheld light-based OTC wrinkle-reduction device.
modality: Handheld multi-wavelength LED wrinkle device
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **regulatory and consumer-device implementation context**.

**Findings:** The source describes a handheld OTC anti-wrinkle light for periorbital wrinkles/rhytides using 605, 630, 660, and 855 nm LED wavelengths and a user-controlled 3-minute treatment.

**Why it matters:** Frames early handheld anti-wrinkle LED device designs and reinforces the need for periocular-use caution.

**Potential experiment signals:** Periorbital treatment area, handheld ergonomics, short session length, multi-wavelength label context, and safety-boundary language.

**Protocol takeaway:** Use as historical device context for periocular use and wavelength mix; do not use as a clinical outcome source.

**Claim use:** `context-only`.
