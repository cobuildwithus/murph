---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:skin-photobiomodulation
slug: families/skin-photobiomodulation
title: Skin Photobiomodulation
summary: Protocols using non-ablative red or near-infrared light exposure to skin for cosmetic texture, wrinkles, and photoaging questions, kept separate from lasers, IPL, PDT, acne modes, ophthalmology PBM, and whole-body wellness panels.
status: draft
quality: usable
aliases:
- skin PBM
- red light for skin
- near-infrared light for skin
- LED skin photomodulation
- cosmetic photobiomodulation
categories:
- skin
- photoaging
- photobiomodulation
- light
familyKind: modality
canonicalMechanism: skin_red_near_infrared_photobiomodulation
relations:
- type: related_protocol
  target: protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging
- type: cites
  target: source_artifact:pmid-38309304
- type: cites
  target: source_artifact:pmid-38307144
- type: cites
  target: source_artifact:pmid-38674067
- type: cites
  target: source_artifact:pmid-24049929
- type: cites
  target: source_artifact:pmid-29356026
- type: cites
  target: source_artifact:pmid-36310510
- type: cites
  target: source_artifact:pmid-40253006
- type: cites
  target: source_artifact:pmid-41032498
researchCoverage:
  summary: The family has mechanistic and dermatology-review support plus heterogeneous human cosmetic trials. Family-level evidence should not be pooled into a single efficacy claim because wavelength, dose, anatomy, comparator, device geometry, and co-interventions vary widely.
  sourceKeys:
  - source_artifact:pmid-38309304
  - source_artifact:pmid-38307144
  - source_artifact:pmid-38674067
  - source_artifact:pmid-24049929
  - source_artifact:pmid-29356026
  - source_artifact:pmid-36310510
  - source_artifact:pmid-40253006
  - source_artifact:pmid-41032498
---

## Family boundary

Skin photobiomodulation in Murph means **non-ablative red or near-infrared light delivered to skin** with the device, wavelength, dose, treatment area, geometry, and eye-protection setup recorded. Mechanistic reviews describe photoreceptor and mitochondrial signaling hypotheses, but those mechanisms are not a substitute for region-specific human outcome evidence. [source_artifact:pmid-38309304; source_artifact:pmid-38307144; source_artifact:pmid-38674067; source_artifact:pmid-24049929]

This family is separate from acne blue-light protocols, lasers, IPL, PDT or photosensitizer protocols, ophthalmology or myopia PBM, transcranial or intranasal PBM, infrared sauna or heat protocols, and whole-body wellness panels. Those areas may share light-related vocabulary, but they use different targets, doses, risks, and outcomes. [source_artifact:pmid-29356026; source_artifact:pmid-36310510; source_artifact:pmid-40253006; source_artifact:pmid-41032498]

## Current canonical protocol

- **Red And Near Infrared Light For Skin Texture And Photoaging** — a constrained adult facial/periocular red+NIR LED/IRED mask starter focused on standardized photos, region-specific texture/wrinkle outcomes, adherence, and tolerability.

## Review posture

Use family evidence to explain mechanisms and boundaries. Use protocol-specific pages for claims about a concrete device class, schedule, treatment area, and outcome plan. Do not turn broad PBM or LED dermatology reviews into a promise that any red-light device reverses photoaging.
