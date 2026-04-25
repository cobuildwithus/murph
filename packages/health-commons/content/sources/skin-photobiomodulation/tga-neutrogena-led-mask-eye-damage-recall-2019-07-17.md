---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:tga-neutrogena-led-mask-eye-damage-recall-2019-07-17
slug: sources/skin-photobiomodulation/tga-neutrogena-led-mask-eye-damage-recall-2019-07-17
title: Neutrogena Visibly Clear Light Therapy Acne Mask and Activator: potential for eye damage recall notice
summary: Australian TGA recall notice for a red-and-blue LED acne mask, citing potential eye damage in susceptible users and possible ocular symptoms.
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
  title: Neutrogena Visibly Clear Light Therapy Acne Mask and Activator: potential for eye damage recall notice
  authors: Therapeutic Goods Administration; Johnson & Johnson Pacific
  year: 2019
  journal: Therapeutic Goods Administration recall notice
  citation: Therapeutic Goods Administration. Neutrogena Visibly Clear Light Therapy Acne Mask and Activator. Published July 17, 2019.
  url: https://www.tga.gov.au/safety/recalls-and-other-market-actions/market-actions/neutrogena-visibly-clear-light-therapy-acne-mask-and-activator
researchEvidence:
  designKind: other
  designLabel: Regulatory recall and safety notice
  populationLabel: Consumers using the Neutrogena Visibly Clear red-and-blue LED acne mask, especially retinal-susceptible users
  durationLabel: Activator limited to 30 sessions of 10 minutes once daily
  aggregateRole: context
  cohortKey: tga-neutrogena-led-mask-eye-damage-recall-2019-07-17
protocolEvidence:
  -
    protocolKey: protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging
    groupId: batch003:tga-neutrogena-led-mask-eye-damage-recall-2019-07-17:ocular
    stance: safety_boundary
    scope: adjacent_variant
    result: not_efficacy_evidence
    headline: Neutrogena Visibly Clear Light Therapy Acne Mask and Activator: potential for eye damage recall notice
    implication: Use as safety-boundary context; do not promote to direct skin efficacy evidence.
    caveat: Regulatory recall for a red+blue acne mask, not a red/NIR photoaging protocol or trial.
    displayPriority: 50
  -
    protocolKey: protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging
    groupId: safety-boundaries
    stance: safety_boundary
    scope: adjacent_variant
    result: not_efficacy_evidence
    headline: Neutrogena Visibly Clear Light Therapy Acne Mask and Activator: potential for eye damage recall notice
    implication: Use as safety-boundary context; do not promote to direct skin efficacy evidence.
    caveat: Regulatory recall for a red+blue acne mask, not a red/NIR photoaging protocol or trial.
    displayPriority: 50
evidenceBucket: eye and face-adjacent ocular safety boundary
whyItMatters: It names consumer-mask ocular symptoms and susceptible populations that belong in conservative safety boundaries.
potentialMurphEndpoints:
  - eye pain
  - tearing
  - blurred vision
  - spots or flashes
  - retinal disorder history
protocolTakeaway: Use as safety-only or context-only evidence; do not use for direct skin-outcome claims.
murphTakeaway: Treat new eye symptoms during facial light use as stop-use signals.
studyDesign: Regulatory recall and safety notice
modality: Home-use red-and-blue LED acne mask
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: unknown
---

This source is included for **eye and face-adjacent ocular safety boundary**.

**Findings:** The TGA warned of possible irreversible retinal damage or accelerated peripheral vision impairment in a small susceptible subset and listed eye pain, discomfort, irritation, tearing, blinding, blurred vision, spots/flashes, and other vision changes.

**Why it matters:** It names consumer-mask ocular symptoms and susceptible populations that belong in conservative safety boundaries.

**Potential experiment signals:** eye pain, tearing, blurred vision, spots or flashes, retinal disorder history.

**Protocol takeaway:** Use as safety-only or context-only evidence; do not use for direct skin-outcome claims.

**Claim use:** `safety-only`.
