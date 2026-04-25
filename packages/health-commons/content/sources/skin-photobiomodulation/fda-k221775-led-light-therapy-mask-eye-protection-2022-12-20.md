---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-k221775-led-light-therapy-mask-eye-protection-2022-12-20
slug: sources/skin-photobiomodulation/fda-k221775-led-light-therapy-mask-eye-protection-2022-12-20
title: 510(k) Summary: LED Light Therapy Mask, models MK-78, MK-04, MK66-H, MK66R-B, EL00003
summary: FDA 510(k) summary for several LED mask models, including red/NIR wrinkle modes and removable eye protection.
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
  title: 510(k) Summary: LED Light Therapy Mask, models MK-78, MK-04, MK66-H, MK66R-B, EL00003
  authors: U.S. Food and Drug Administration; Shenzhen Kaiyan Medical Equipment Co., Ltd.
  year: 2022
  journal: FDA 510(k) Premarket Notification
  citation: U.S. Food and Drug Administration. 510(k) Summary: LED Light Therapy Mask (K221775). Decision date December 20, 2022.
  url: https://www.accessdata.fda.gov/cdrh_docs/pdf22/K221775.pdf
researchEvidence:
  designKind: other
  designLabel: FDA 510(k) summary and nonclinical performance documentation
  populationLabel: OTC users of home-use LED masks indicated for wrinkles and, for some models, acne
  durationLabel: Wrinkle protocol summarized as 10 minutes, 5 times weekly for 6 weeks
  aggregateRole: context
  cohortKey: fda-k221775-led-light-therapy-mask-eye-protection-2022-12-20
protocolEvidence:
  -
    protocolKey: protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging
    groupId: batch003:fda-k221775-led-light-therapy-mask-eye-protection-2022-12-20:ocular
    stance: safety_boundary
    scope: direct_protocol
    result: not_efficacy_evidence
    headline: 510(k) Summary: LED Light Therapy Mask, models MK-78, MK-04, MK66-H, MK66R-B, EL00003
    implication: Use as safety-boundary context; do not promote to direct skin efficacy evidence.
    caveat: Regulatory substantial-equivalence summary, not independent clinical efficacy evidence.
    displayPriority: 50
evidenceBucket: eye and face-adjacent ocular safety boundary
whyItMatters: It documents removable eye protection in red/NIR LED face-mask designs used for wrinkle indications.
potentialMurphEndpoints:
  - eye protection installed
  - dose
  - session duration
  - weekly frequency
protocolTakeaway: Use as safety-only or context-only evidence; do not use for direct skin-outcome claims.
murphTakeaway: Treat new eye symptoms during facial light use as stop-use signals.
studyDesign: FDA 510(k) summary and nonclinical performance documentation
modality: Home-use red/NIR and blue/red/NIR LED masks
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **eye and face-adjacent ocular safety boundary**.

**Findings:** The summary lists red 630 ± 5 nm and NIR 830 nm wrinkle modes, 10-minute treatments, model-specific 12–18 or 18 J/cm² dose, and removable eye protection.

**Why it matters:** It documents removable eye protection in red/NIR LED face-mask designs used for wrinkle indications.

**Potential experiment signals:** eye protection installed, dose, session duration, weekly frequency.

**Protocol takeaway:** Use as safety-only or context-only evidence; do not use for direct skin-outcome claims.

**Claim use:** `safety-only`.
