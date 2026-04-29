---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:evening-light-reduction
slug: families/evening-light-reduction
title: Evening Light Reduction
summary: Protocols that lower melanopic or short-wavelength light exposure in the pre-bed window while keeping adjacent light-emitting red/near-infrared, light-therapy, shift-work, and clinical virtual-darkness variants separate.
status: draft
quality: usable
aliases:
- dim evening light
- short-wavelength light reduction
- melanopic light reduction before bed
- evening light management
categories:
- sleep
- circadian
- evening-light
familyKind: mechanism
canonicalMechanism: lower_evening_melanopic_light
relations:
- type: related_protocol
  target: protocol_variant:evening-light-reduction/red-light-glasses-before-bed
claims:
- claimId: family-scope-prebed-melanopic-reduction
  type: evidence_scope
  text: Evening light reduction covers pre-bed changes that reduce short-wavelength or melanopic retinal input; it should stay separate from light-emitting red/near-infrared protocols, daytime light exposure, psychiatric virtual darkness, shift-work adaptation, and multicomponent chronotherapy unless those variants are explicitly labeled.
  strength: high
  sourceKeys:
  - source_artifact:evening-light-reduction-pmid-35298459
  - source_artifact:evening-light-reduction-pmid-40728371
  - source_artifact:evening-light-reduction-pmid-31752544
  - source_artifact:pmid-19637050
  - source_artifact:evening-light-reduction-pmid-27226262
  - source_artifact:doi-10.1001-jamapediatrics.2026.0976
  - source_artifact:evening-light-reduction-pmid-27322730
  - source_artifact:evening-light-reduction-pmid-26414986
  - source_artifact:evening-light-reduction-pmid-41166315
  - source_artifact:evening-light-reduction-pmid-39642162
  - source_artifact:pmid-33588653
  - source_artifact:pmid-23834705
  - source_artifact:evening-light-reduction-pmid-35024497
  - source_artifact:evening-light-reduction-pmid-35089982
  - source_artifact:evening-light-reduction-pmid-41421618
- claimId: family-dose-measurement-guardrail
  type: design_guardrail
  text: Within this family, dose should be defined by timing, spectrum, intensity, fit or leakage, and room or screen context rather than by a vague blue-light label alone.
  strength: high
  sourceKeys:
  - source_artifact:evening-light-reduction-doi-10.25039-s026.2018
  - source_artifact:evening-light-reduction-pmid-40728371
  - source_artifact:pmid-34983271
  - source_artifact:pmid-31696535
researchCoverage:
  auditCutoff: '2026-04-27'
  canonicalSourceRecords: 214
  extractedSourcePages: 161
---
Evening light reduction is a mechanism family for protocols that lower pre-bed short-wavelength or melanopic light reaching the eyes. The family can include eyewear, room-light changes, screen-light changes, or broader circadian packages, but each variant needs its own dose definition and evidence boundaries [source_artifact:evening-light-reduction-pmid-35298459; source_artifact:evening-light-reduction-pmid-40728371; source_artifact:evening-light-reduction-doi-10.25039-s026.2018].

For the Murph canonical package, `Red Light Glasses Before Bed` is the first runnable variant. Adjacent clinical or timing variants—delayed sleep phase, shift work, pregnancy or postpartum contexts, adolescent or schoolchild chronotherapy, bipolar or mania virtual darkness, and psychiatric ward lighting—belong in separate pages or landscape groups rather than being treated as direct evidence for the default adult bedtime-glasses run [source_artifact:evening-light-reduction-pmid-31752544; source_artifact:pmid-19637050; source_artifact:pmid-23834705; source_artifact:pmid-33588653; source_artifact:evening-light-reduction-pmid-26414986; source_artifact:evening-light-reduction-pmid-27322730; source_artifact:evening-light-reduction-pmid-35024497; source_artifact:evening-light-reduction-pmid-35089982; source_artifact:doi-10.1001-jamapediatrics.2026.0976; source_artifact:evening-light-reduction-pmid-41166315; source_artifact:evening-light-reduction-pmid-27226262; source_artifact:evening-light-reduction-pmid-41421618; source_artifact:evening-light-reduction-pmid-39642162].
