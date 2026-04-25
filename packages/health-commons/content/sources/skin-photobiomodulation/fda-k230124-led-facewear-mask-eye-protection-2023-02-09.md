---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-k230124-led-facewear-mask-eye-protection-2023-02-09
slug: sources/skin-photobiomodulation/fda-k230124-led-facewear-mask-eye-protection-2023-02-09
title: 510(k) Summary: LUSTRE ClearSkin Renew Pro Facewear Mask
summary: FDA 510(k) summary for a facewear LED mask with red/NIR wrinkle mode, red/blue acne mode, default 10-minute treatment, and removable eye protection.
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
  title: 510(k) Summary: LUSTRE ClearSkin Renew Pro Facewear Mask
  authors: U.S. Food and Drug Administration; Ambicare Health Ltd.
  year: 2023
  journal: FDA 510(k) Premarket Notification
  citation: U.S. Food and Drug Administration. 510(k) Summary: LUSTRE ClearSkin Renew Pro Facewear Mask (K230124). Decision date February 9, 2023.
  url: https://www.accessdata.fda.gov/cdrh_docs/pdf23/K230124.pdf
researchEvidence:
  designKind: other
  designLabel: FDA 510(k) summary and nonclinical performance documentation
  populationLabel: OTC users of a facewear LED mask indicated for full-face wrinkles and acne modes
  durationLabel: Default treatment lasts 10 minutes; wrinkle schedule summarized as 5 times weekly for 6 weeks
  aggregateRole: context
  cohortKey: fda-k230124-led-facewear-mask-eye-protection-2023-02-09
protocolEvidence:
  -
    protocolKey: protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging
    groupId: batch003:fda-k230124-led-facewear-mask-eye-protection-2023-02-09:ocular
    stance: safety_boundary
    scope: direct_protocol
    result: not_efficacy_evidence
    headline: 510(k) Summary: LUSTRE ClearSkin Renew Pro Facewear Mask
    implication: Use as safety-boundary context; do not promote to direct skin efficacy evidence.
    caveat: The extracted summary did not include a clinical study; it is regulatory context only.
    displayPriority: 50
evidenceBucket: eye and face-adjacent ocular safety boundary
whyItMatters: It provides red/NIR dose context and explicitly identifies eye protection as a device component.
potentialMurphEndpoints:
  - removable eye protection
  - session duration
  - wavelength mode
  - dose
protocolTakeaway: Use as safety-only or context-only evidence; do not use for direct skin-outcome claims.
murphTakeaway: Treat new eye symptoms during facial light use as stop-use signals.
studyDesign: FDA 510(k) summary and nonclinical performance documentation
modality: 630 nm red and 830 nm infrared facewear mask, with blue/red acne mode
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **eye and face-adjacent ocular safety boundary**.

**Findings:** The summary describes red 630 nm and infrared 830 nm wrinkle treatment, total intensity of 30 mW/cm², red and NIR doses of 10.8 and 7.2 J/cm², default 10-minute sessions, and removable eye protection.

**Why it matters:** It provides red/NIR dose context and explicitly identifies eye protection as a device component.

**Potential experiment signals:** removable eye protection, session duration, wavelength mode, dose.

**Protocol takeaway:** Use as safety-only or context-only evidence; do not use for direct skin-outcome claims.

**Claim use:** `safety-only`.
