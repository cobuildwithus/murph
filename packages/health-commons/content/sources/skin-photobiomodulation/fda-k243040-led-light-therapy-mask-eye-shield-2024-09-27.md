---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-k243040-led-light-therapy-mask-eye-shield-2024-09-27
slug: sources/skin-photobiomodulation/fda-k243040-led-light-therapy-mask-eye-shield-2024-09-27
title: 510(k) Summary: Shenzhen Siken LED Light Therapy Mask
summary: FDA 510(k) summary for an LED mask documenting red, blue, and infrared LEDs and an incorporated protective eye shield.
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
  title: 510(k) Summary: Shenzhen Siken LED Light Therapy Mask
  authors: U.S. Food and Drug Administration; Shenzhen Siken 3D Technology Development Co., Ltd.
  year: 2024
  journal: FDA 510(k) Premarket Notification
  citation: U.S. Food and Drug Administration. 510(k) Summary: Shenzhen Siken LED Light Therapy Mask (K243040). Decision date September 27, 2024.
  url: https://www.accessdata.fda.gov/cdrh_docs/pdf24/K243040.pdf
researchEvidence:
  designKind: other
  designLabel: FDA 510(k) summary and nonclinical performance documentation
  populationLabel: OTC users of an LED light therapy mask indicated for wrinkles and mild-to-moderate acne
  durationLabel: Per-treatment auto shutoff described; schedule not used as efficacy evidence here
  aggregateRole: context
  cohortKey: fda-k243040-led-light-therapy-mask-eye-shield-2024-09-27
protocolEvidence:
  -
    protocolKey: protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging
    groupId: batch003:fda-k243040-led-light-therapy-mask-eye-shield-2024-09-27:ocular
    stance: safety_boundary
    scope: adjacent_variant
    result: not_efficacy_evidence
    headline: 510(k) Summary: Shenzhen Siken LED Light Therapy Mask
    implication: Use as safety-boundary context; do not promote to direct skin efficacy evidence.
    caveat: Regulatory documentation and blue/red/IR mixed-mode device, not a skin efficacy source.
    displayPriority: 50
evidenceBucket: eye and face-adjacent ocular safety boundary
whyItMatters: It shows that consumer LED masks may incorporate protective eye shields and optical-radiation testing.
potentialMurphEndpoints:
  - protective eye shield
  - auto shutoff
  - eye-safety standard
  - wavelength mode
protocolTakeaway: Use as safety-only or context-only evidence; do not use for direct skin-outcome claims.
murphTakeaway: Treat new eye symptoms during facial light use as stop-use signals.
studyDesign: FDA 510(k) summary and nonclinical performance documentation
modality: Red, blue, and infrared LED mask
claimUse: safety-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **eye and face-adjacent ocular safety boundary**.

**Findings:** The summary describes red 620 ± 10 nm, blue 460 ± 10 nm, and infrared 850 ± 10 nm LEDs, auto turn-off, and an incorporated protective eye shield blocking LED light energy from the eyes.

**Why it matters:** It shows that consumer LED masks may incorporate protective eye shields and optical-radiation testing.

**Potential experiment signals:** protective eye shield, auto shutoff, eye-safety standard, wavelength mode.

**Protocol takeaway:** Use as safety-only or context-only evidence; do not use for direct skin-outcome claims.

**Claim use:** `safety-only`.
