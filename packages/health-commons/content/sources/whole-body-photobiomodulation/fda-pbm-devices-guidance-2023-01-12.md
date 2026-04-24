---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-pbm-devices-guidance-2023-01-12
slug: sources/whole-body-photobiomodulation/fda-pbm-devices-guidance-2023-01-12
title: Photobiomodulation (PBM) Devices - Premarket Notification [510(k)] Submissions Guidance for Industry and Food and Drug Administration Staff
summary: FDA draft guidance defining PBM as non-heating light therapy and outlining device-description, parameter-reporting, thermal/eye-safety, and clinical testing expectations; regulatory boundary source, not efficacy evidence.
status: draft
quality: usable
aliases:
  - fda-pbm-devices-guidance-2023-01-12
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
  kind: other
  title: Photobiomodulation (PBM) Devices - Premarket Notification [510(k)] Submissions Guidance for Industry and Food and Drug Administration Staff
  authors: U.S. Food and Drug Administration
  year: 2023
  journal: U.S. Food and Drug Administration
  citation: U.S. Food and Drug Administration. Photobiomodulation (PBM) Devices - Premarket Notification [510(k)] Submissions Guidance for Industry and Food and Drug Administration Staff. Draft guidance. Issued January 12, 2023.
  url: https://www.fda.gov/media/164417/download
researchEvidence:
  designKind: guideline
  designLabel: Draft FDA device guidance for PBM 510(k) submissions
  populationLabel: PBM device manufacturers and clinical evaluation frameworks
  durationLabel: Not applicable; regulatory guidance
  aggregateRole: context
  cohortKey: fda-2023-pbm-guidance
protocolEvidence:
  -
    protocolKey: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
    groupId: regulatory-definition-and-safety-boundaries
    stance: context_only
    scope: general_guideline
    result: not_efficacy_evidence
    headline: FDA defines PBM as non-heating light therapy and expects wavelength, dose, irradiance, pulsing, target-area, and safety reporting in premarket submissions.
    implication: Useful for device-description completeness and for keeping whole-body claims inside nonthermal, safety-aware boundaries.
    caveat: Draft nonbinding regulatory guidance rather than a clinical efficacy study.
    displayPriority: 45
evidenceBucket: Dose, device, and implementation reporting
whyItMatters: It provides an official nonthermal PBM definition plus a practical checklist of parameters and safety tests that should remain visible in protocol documentation.
potentialMurphEndpoints:
  - skin heating
  - eye symptoms
  - session parameters
  - adverse events
protocolTakeaway: Use as a regulatory-definition and safety-boundary source, not as evidence that a whole-body protocol works.
murphTakeaway: This source helps keep the protocol inside nonthermal PBM boundaries and forces clearer documentation of what a device is actually delivering.
studyDesign: Regulatory guidance
modality: PBM device regulatory guidance
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **Dose, device, and implementation reporting**.

**Findings:** This FDA draft guidance describes PBM devices as devices designed to deliver a non-heating dose of light energy into the body and defines PBM as the application of light at an irradiance that does not induce heating, with the goal of altering biological activity. It states that PBM may use coherent light sources such as lasers, non-coherent sources such as LEDs or filtered broadband lamps, or both. The guidance also treats wavelength, energy fluence or radiant dose, output mode, radiant power and irradiance, beam spot size, pulsing parameters, thermal safety, eye safety, adverse-event monitoring, and clinical performance testing as core parts of device description and submission review.

**Why it matters:** This is the best official source in the batch for drawing nonthermal PBM boundaries and for keeping device-reporting fields explicit.

**Potential experiment signals:** thermal comfort, eye symptoms, adverse events, wavelength, fluence, irradiance, pulsing mode.

**Protocol takeaway:** Use as background for definition, safety, and reporting completeness. Do not use it to imply clinical benefit.

**Claim use:** `context-only`.
