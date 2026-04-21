---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:evening-light-reduction
slug: families/evening-light-reduction
title: Evening Light Reduction
summary: Protocols that lower melanopic or short-wavelength light exposure in the pre-bed window, separated from daytime light exposure, light therapy, and psychiatric virtual-darkness protocols.
status: draft
quality: usable
aliases:
  - dim evening light
  - short-wavelength light reduction
  - melanopic light reduction before bed
categories:
  - sleep
  - circadian
  - evening-light
familyKind: mechanism
canonicalMechanism: lower_evening_melanopic_light
relations:
  -
    type: related_protocol
    target: protocol_variant:red-light-glasses-before-bed/red-light-glasses-before-bed
  -
    type: cites
    target: source_artifact:pmid-35298459
  -
    type: cites
    target: source_artifact:doi-10.17617-1.4a6s-ec74
  -
    type: cites
    target: source_artifact:pmid-40728371
  -
    type: cites
    target: source_artifact:pmid-41341515
researchCoverage:
  bibliographyKey: source_artifact:red-light-glasses-before-bed-bibliography
  auditCutoff: 2026-04-20
---

Evening light reduction is the broader family for experiments that reduce melanopic or short-wavelength light exposure near bedtime.

This family should not teach “blue light is bad.” The intended pattern is brighter, well-timed daytime light and lower evening/night light. Strong daytime blue-blocking, screen software, room-light redesign, light therapy, shift-work protocols, and psychiatric virtual-darkness protocols should remain separate variants.
