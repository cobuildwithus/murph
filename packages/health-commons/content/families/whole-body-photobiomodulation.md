---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:whole-body-photobiomodulation
slug: families/whole-body-photobiomodulation
title: Whole-Body Photobiomodulation
summary: Whole-body nonthermal red and near-infrared photobiomodulation protocols, kept separate from localized PBM, exercise-timed variants, fibromyalgia treatment variants, cosmetic large-area skin protocols, red-light glasses, bright-light therapy, infrared sauna, and UV-tanning devices.
status: draft
quality: usable
aliases:
  - whole-body PBM
  - whole-body PBMT
  - whole-body red light therapy
  - whole-body red and near-infrared light therapy
  - full-body photobiomodulation
  - full-body red light bed
categories:
  - photobiomodulation
  - light
  - red-light
  - near-infrared
  - whole-body
familyKind: modality
canonicalModality: whole_body_photobiomodulation
relations:
  -
    type: related_protocol
    target: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
  -
    type: cites
    target: source_artifact:whole-body-photobiomodulation-bibliography
  -
    type: cites
    target: source_artifact:pmid-40253006
  -
    type: cites
    target: source_artifact:pmid-36671752
  -
    type: cites
    target: source_artifact:clinicaltrials-gov-nct05116605-2026-04-23
  -
    type: cites
    target: source_artifact:clinicaltrials-gov-nct05963555-2026-04-23
  -
    type: cites
    target: source_artifact:pmid-41228430
  -
    type: cites
    target: source_artifact:pmid-39883205
  -
    type: cites
    target: source_artifact:pmid-36369323
  -
    type: cites
    target: source_artifact:pmid-38356644
  -
    type: cites
    target: source_artifact:pmid-24286286
  -
    type: cites
    target: source_artifact:pmid-36927734
  -
    type: cites
    target: source_artifact:pmid-37593770
  -
    type: cites
    target: source_artifact:pmid-37002704
  -
    type: cites
    target: source_artifact:pmid-19602651
  -
    type: cites
    target: source_artifact:iarc-sunbeds-uv-radiation-2009-07-29
researchCoverage:
  bibliographyKey: source_artifact:whole-body-photobiomodulation-bibliography
  corpusStats:
    canonicalSourceRecords: 205
    draftedSourcePages: 86
    auditCutoff: 2026-04-23
---

Whole-body photobiomodulation is the family for **nonthermal large-area red and near-infrared light exposure** intended to irradiate much of the body at once.

## What belongs in this family

Use this family when the intervention is fundamentally a **whole-body red/NIR PBM setup** such as a light bed or pod, and when the mechanism is meant to be photobiomodulation rather than heating, tanning, or circadian blue-light filtering.

## What stays separate

This family stays separate from exercise-timed whole-body PBM variants, fibromyalgia and chronic-pain treatment variants, cosmetic or photoaging large-area light-bed variants, transcranial or intranasal PBM, red-light or blue-blocking glasses, bright-light therapy, infrared sauna, and UV tanning. Those literatures still matter, but mostly as **boundaries, context, or sibling variants** rather than as direct proof for the general Murph protocol. (source_artifact:pmid-39883205; source_artifact:pmid-36369323; source_artifact:pmid-38356644; source_artifact:pmid-24286286; source_artifact:pmid-36927734; source_artifact:pmid-37593770; source_artifact:pmid-37002704; source_artifact:pmid-19602651; source_artifact:iarc-sunbeds-uv-radiation-2009-07-29)

## How to read the evidence

The whole-body PBM corpus is broader than the exact Murph variant. The family includes direct but still sparse whole-body records, implementation and dose-reporting sources, sibling-variant literatures with stronger but population-specific positives, safety and screening boundaries, and adjacent modalities that should not be collapsed into “red light.” The clean family-level conclusion is narrow: whole-body red/NIR PBM is a real modality with measurable signals in narrow contexts, but the direct evidence for a general healthy-adult sleep or recovery protocol remains limited, adjacent, device-specific, and parameter-sensitive. (source_artifact:pmid-40253006; source_artifact:pmid-36671752; source_artifact:clinicaltrials-gov-nct05116605-2026-04-23; source_artifact:clinicaltrials-gov-nct05963555-2026-04-23; source_artifact:pmid-41228430)
