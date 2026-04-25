---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:canada-risk-thermal-harm-energy-devices-2020-08-21
slug: sources/skin-photobiomodulation/canada-risk-thermal-harm-energy-devices-2020-08-21
title: Risk of thermal harm from therapeutic and cosmetic energy-emitting medical devices
summary: Regulatory notice flags >45°C surface skin temperature as unsafe without objective rationale and includes LEDs among covered energy devices. Included for thermal injury and energy-device safety boundary; claim use is safety-only.
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
  title: Risk of thermal harm from therapeutic and cosmetic energy-emitting medical devices
  authors: Health Canada
  year: 2020
  journal: Health Canada
  citation: Health Canada. Risk of thermal harm from therapeutic and cosmetic energy-emitting medical devices. Health Canada. 2020.
  url: https://www.canada.ca/en/health-canada/services/drugs-health-products/medical-devices/activities/announcements/notice-risk-thermal-harm-therapeutic-medical-lasers-intense-pulsed-light-emitting-diodes.html
researchEvidence:
  designKind: guideline
  designLabel: Regulatory safety notice on thermal harm from cosmetic and therapeutic energy-emitting medical devices
  populationLabel: Users of therapeutic and cosmetic energy-emitting medical devices, including in clinics and salons.
  durationLabel: Not applicable.
  aggregateRole: primary
  cohortKey: cohort:canada-risk-thermal-harm-energy-devices-2020-08-21
evidenceBucket: thermal injury and energy-device safety boundary
whyItMatters: Use for heat-related stop rules, device-temperature caution, and avoiding protocols that seek heating as a benefit.
potentialMurphEndpoints:
  - surface temperature limit
  - burning/warmth stop rule
  - worst-case device setup check
  - Fitzpatrick coverage
protocolTakeaway: Regulatory notice flags >45°C surface skin temperature as unsafe without objective rationale and includes LEDs among covered energy devices. Specific device risk depends on irradiance, contact, motion, spot size, skin type, and testing.
murphTakeaway: Use for heat-related stop rules, device-temperature caution, and avoiding protocols that seek heating as a benefit.
studyDesign: Regulatory safety notice on thermal harm from cosmetic and therapeutic energy-emitting medical devices
modality: energy-emitting devices including LEDs
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: unknown
---

This source is included for **thermal injury and energy-device safety boundary**.

**Findings:** Health Canada states the notice applies to LEDs among other devices, that labeling alone may be inadequate for end users with limited training, and that surface skin temperature above 45°C without objective/sound rationale is deemed unsafe.

**Why it matters:** Use for heat-related stop rules, device-temperature caution, and avoiding protocols that seek heating as a benefit.

**Potential experiment signals:** surface temperature limit, burning/warmth stop rule, worst-case device setup check, Fitzpatrick coverage.

**Protocol takeaway:** Regulatory notice flags >45°C surface skin temperature as unsafe without objective rationale and includes LEDs among covered energy devices. Specific device risk depends on irradiance, contact, motion, spot size, skin type, and testing.

**Claim use:** `safety-only`.

### Extraction notes

- **Population:** Users of therapeutic and cosmetic energy-emitting medical devices, including in clinics and salons.
- **Intervention/exposure:** Energy-emitting devices including lasers, ultrasound, RF, IPL, and LEDs.
- **Comparator/control:** Not applicable.
- **Duration/follow-up:** Not applicable.
- **Endpoints:** Thermal injury, skin temperature testing, worst-case exposure, Fitzpatrick skin-type representation, labeling adequacy, and safety thresholds.
- **Adverse events/safety notes:** Thermal harm, burns, erythema, blistering, and pigmentary complications are relevant device-safety concerns.
- **Limitations:** Regulatory notice, not a clinical red/NIR photoaging trial.; Thermal threshold is a safety boundary, not a therapeutic target.; Device-specific testing is required.
- **Population mismatch/directness:** Direct thermal safety boundary for energy devices including LEDs; not efficacy evidence.
- **Artifact/rights status:** unknown.
