---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nice-intranasal-phototherapy-for-allergic-rhinitis-2018-06-13
slug: sources/whole-body-photobiomodulation/nice-intranasal-phototherapy-for-allergic-rhinitis-2018-06-13
title: Intranasal phototherapy for allergic rhinitis
summary: NICE judged intranasal phototherapy for allergic rhinitis supported only by limited evidence and recommended use only in research.
status: draft
quality: usable
aliases:
  - nice-intranasal-phototherapy-for-allergic-rhinitis-2018-06-13
  - IPG616
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
  kind: guideline
  title: Intranasal phototherapy for allergic rhinitis
  authors: National Institute for Health and Care Excellence
  year: 2018
  journal: NICE Interventional Procedures Guidance
  citation: National Institute for Health and Care Excellence. Intranasal phototherapy for allergic rhinitis. Interventional procedures guidance IPG616. 2018.
  url: https://www.nice.org.uk/guidance/ipg616
researchEvidence:
  designKind: guideline
  designLabel: Interventional procedures guidance
  populationLabel: People with allergic rhinitis considered for intranasal phototherapy
  durationLabel: Procedure typically delivered for several minutes per session; NICE emphasized repeated-use and long-term safety as research needs
  aggregateRole: synthesis
  cohortKey: nice-2018-intranasal-phototherapy-rhinitis
evidenceBucket: Adjacent-variant and exclusion boundary anchors
whyItMatters: It gives a high-quality external benchmark for keeping intranasal phototherapy separate from whole-body PBM and for emphasizing parameter reporting and long-term safety.
potentialMurphEndpoints:
  - symptom scores
  - wavelength/intensity reporting
  - long-term safety
  - repeat-use effects
protocolTakeaway: Use as a safety and research-only boundary source, not as efficacy support for whole-body red/NIR exposure.
murphTakeaway: Strong reminder that neighboring light modalities may remain research-only when evidence quality is limited.
studyDesign: NICE interventional procedures guidance
modality: Intranasal phototherapy for allergic rhinitis using light-emitting nasal probes
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: permission_required
---

This source is included for **Adjacent-variant and exclusion boundary anchors**.

**Findings:** NICE states that current evidence on efficacy and safety for intranasal phototherapy in allergic rhinitis is limited in both quantity and quality and that the procedure should therefore be used only in the context of research. The guidance describes a procedure delivered with light-emitting probes placed in the nasal cavity and notes that devices and wavelengths vary from ultraviolet to infrared. It also lists research-reporting priorities, including patient selection, medication use, underlying conditions, light intensity, duration, wavelength, patient-reported outcomes, comparison with existing treatments, repeated use, and long-term safety. Population mismatch is direct because this is an intranasal rhinitis procedure, not whole-body red/NIR exposure.

**Why it matters:** It offers a high-quality cautionary boundary around nearby intranasal light interventions and emphasizes the need for detailed parameter reporting.

**Potential experiment signals:** symptom scores, wavelength/intensity reporting, long-term safety, repeat-use effects.

**Protocol takeaway:** Treat this as a research-only and safety boundary source. It should not be used to justify whole-body PBM benefits.

**Claim use:** `safety-only`.
