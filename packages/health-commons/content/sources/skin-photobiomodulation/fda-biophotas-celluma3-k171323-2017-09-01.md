---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-biophotas-celluma3-k171323-2017-09-01
slug: sources/skin-photobiomodulation/fda-biophotas-celluma3-k171323-2017-09-01
title: 510(k) Summary: BioPhotas Celluma3
summary: FDA 510(k) context for a visible/infrared LED panel or flexible light-therapy device with a full-face wrinkle indication; useful for dose and ergonomics boundaries only.
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
  title: 510(k) Summary: BioPhotas Celluma3
  authors: U.S. Food and Drug Administration; BioPhotas Inc.
  year: 2017
  journal: FDA 510(k) Premarket Notification
  citation: U.S. Food and Drug Administration; BioPhotas Inc. 510(k) Summary: BioPhotas Celluma3. FDA 510(k) Premarket Notification; 2017. K171323.
  url: https://www.accessdata.fda.gov/cdrh_docs/pdf17/K171323.pdf
researchEvidence:
  designKind: other
  designLabel: FDA 510(k) summary; LED panel/flexible device parameters
  populationLabel: Users receiving visible and infrared light therapy for full-face wrinkles; no extracted clinical cohort from the regulatory summary.
  durationLabel: Device summary context reports 30-minute treatments, three times weekly for four weeks; clinical follow-up not extracted.
  aggregateRole: context
  cohortKey: fda-biophotas-celluma3-2017
evidenceBucket: regulatory and consumer-device implementation context
whyItMatters: Adds a non-mask LED form factor with explicit red/NIR wavelength and dose context, helping separate ergonomics from biological claims.
potentialMurphEndpoints:
  - panel-vs-mask
  - power-density
  - fluence
  - session-length
  - weekly-frequency
protocolTakeaway: Use as a dose and form-factor context source for red/NIR full-face LED implementation; do not cite as efficacy evidence.
murphTakeaway: Helpful for parameter comparison between consumer masks and flexible/panel LED devices.
studyDesign: Regulatory 510(k) summary for a visible/infrared LED therapy device with wrinkle indication.
modality: Visible/infrared LED panel or flexible device
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **regulatory and consumer-device implementation context**.

**Findings:** The source describes a red/NIR LED device with 640 nm ±25 and 880 nm ±50 wavelengths, intensity around 6.5 mW/cm², dose around 11.7 J/cm², 30-minute sessions, and three treatments weekly for four weeks.

**Why it matters:** Adds a non-mask LED form factor with explicit red/NIR wavelength and dose context, helping separate ergonomics from biological claims.

**Potential experiment signals:** Wavelengths, intensity, fluence, weekly frequency, panel/flexible-device form factor, and full-face wrinkle indication.

**Protocol takeaway:** Use as a dose and form-factor context source for red/NIR full-face LED implementation; do not cite as efficacy evidence.

**Claim use:** `context-only`.
