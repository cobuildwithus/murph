---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:iarc-sunbeds-uv-radiation-2009-07-29
slug: sources/whole-body-photobiomodulation/iarc-sunbeds-uv-radiation-2009-07-29
title: Sunbeds and UV Radiation
summary: IARC statement classifies UV-emitting tanning devices as carcinogenic to humans, setting a hard boundary against sunbed analogies.
status: draft
quality: usable
aliases:
  - iarc-sunbeds-uv-radiation-2009-07-29
categories:
  - whole-body-photobiomodulation
relations:
  -
    type: related_protocol
    target: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
  -
    type: parent_family
    target: experiment_family:whole-body-photobiomodulation
source:
  kind: web_page
  title: Sunbeds and UV Radiation
  authors: International Agency for Research on Cancer
  year: 2009
  journal: International Agency for Research on Cancer
  citation: International Agency for Research on Cancer. Sunbeds and UV Radiation. 2009.
  url: https://www.iarc.who.int/news-events/sunbeds-and-uv-radiation/
researchEvidence:
  designKind: other
  designLabel: Agency statement / web page
  populationLabel: Public-health statement on UV-emitting tanning devices
  durationLabel: Not applicable
  aggregateRole: context
  cohortKey: iarc-2009-sunbeds-uv-radiation
protocolEvidence:
  -
    protocolKey: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
    groupId: family-definition-and-boundaries
    stance: safety_boundary
    scope: general_guideline
    result: not_efficacy_evidence
    headline: IARC classifies UV-emitting tanning devices as carcinogenic to humans.
    implication: This is the sharpest authoritative boundary against using sunbed or tanning-device comparisons in a whole-body red/NIR protocol.
    caveat: The source addresses ultraviolet carcinogenicity, not therapeutic photobiomodulation.
    displayPriority: 50
evidenceBucket: Adjacent-variant and exclusion boundary anchors
whyItMatters: It is the canonical safety-boundary statement showing that UV sunbeds sit in a carcinogenic-risk category, not a therapeutic PBM category.
potentialMurphEndpoints:
  - UV exposure screening
  - skin-cancer risk boundary
  - device-classification boundary
protocolTakeaway: Use only to reinforce the UV safety boundary and to avoid misleading whole-body-light-bed analogies.
murphTakeaway: "Strong exclusion anchor: sunbeds are UV carcinogenicity sources, not evidence for PBM."
studyDesign: Authoritative agency statement
modality: UV-emitting tanning devices and sunbeds
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: unknown
---

This source is included for **Adjacent-variant and exclusion boundary anchors**.

**Findings:** IARC states that UV-emitting tanning devices are carcinogenic to humans, placing them in Group 1. This is not efficacy evidence and does not speak to red/NIR therapeutic photobiomodulation. Its value here is entirely boundary-setting: it prevents whole-body PBM devices from being casually compared with UV-emitting sunbeds.

**Why it matters:** It supplies the clearest authoritative sentence for separating therapeutic red/NIR PBM from UV tanning.

**Potential experiment signals:** UV exposure screening, skin-cancer risk boundary, device-classification boundary.

**Protocol takeaway:** Use strictly as a safety-boundary source. It should never be presented as evidence about therapeutic whole-body PBM.

**Claim use:** `safety-only`.
