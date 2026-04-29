---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:cdc-sun-exposure-photosensitizing-medications-2025-04-23
slug: sources/skin-photobiomodulation/cdc-sun-exposure-photosensitizing-medications-2025-04-23
title: Sun Exposure in Travelers
summary: CDC travel guidance flags common medication categories associated with sun photosensitivity. Included for photosensitizing-medication and retinoid safety boundary; claim use is safety-only.
status: draft
quality: usable
aliases:
- source_artifact:cdc-sun-exposure-photosensitizing-medications-2025-04-23
- Sun Exposure in Travelers
categories:
- skin-photobiomodulation
relations:
- type: related_protocol
  target: protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging
- type: parent_family
  target: experiment_family:skin-photobiomodulation
source:
  kind: web_page
  title: Sun Exposure in Travelers
  authors: Centers for Disease Control and Prevention
  year: 2025
  journal: CDC Yellow Book
  citation: Centers for Disease Control and Prevention. Sun Exposure in Travelers. CDC Yellow Book. 2025.
  url: https://www.cdc.gov/yellow-book/hcp/environmental-hazards-risks/sun-exposure.html
researchEvidence:
  designKind: guideline
  designLabel: Public-health guidance for sun exposure and photosensitizing medications
  populationLabel: Travelers and clinicians assessing sun exposure and medication risk.
  durationLabel: Not applicable.
  aggregateRole: context
  cohortKey: cohort:cdc-sun-exposure-photosensitizing-medications-2025-04-23
evidenceBucket: photosensitizing-medication and retinoid safety boundary
whyItMatters: Use as a conservative intake checklist and prompt for clinician/pharmacist review.
potentialMurphEndpoints:
- medication category checklist
- cancer therapy history
- sunburn-like reaction stop rule
protocolTakeaway: CDC travel guidance flags common medication categories associated with sun photosensitivity. Sun/UV photosensitivity does not automatically equal red/NIR PBM photosensitivity.
murphTakeaway: Use as a conservative intake checklist and prompt for clinician/pharmacist review.
studyDesign: Public-health guidance for sun exposure and photosensitizing medications
modality: sun exposure plus medications
claimUse: safety-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **photosensitizing-medication and retinoid safety boundary**.

**Findings:** CDC Yellow Book guidance lists medication categories associated with photosensitivity, including doxycycline/tetracyclines, fluoroquinolones, sulfonamides, NSAIDs, cancer therapies, furosemide, methotrexate, sulfonylureas, thiazides, and retinoids.

**Why it matters:** Use as a conservative intake checklist and prompt for clinician/pharmacist review.

**Potential experiment signals:** medication category checklist, cancer therapy history, sunburn-like reaction stop rule.

**Protocol takeaway:** CDC travel guidance flags common medication categories associated with sun photosensitivity. Sun/UV photosensitivity does not automatically equal red/NIR PBM photosensitivity.

**Claim use:** `safety-only`.

### Extraction notes

- **Population:** Travelers and clinicians assessing sun exposure and medication risk.
- **Intervention/exposure:** Sun exposure while using potentially photosensitizing medications.
- **Comparator/control:** Not applicable.
- **Duration/follow-up:** Not applicable.
- **Endpoints:** Sunburn, photosensitivity, medication categories, and prevention measures.
- **Adverse events/safety notes:** Sunburn-like reactions and photosensitivity are relevant; cancer therapy effects may linger after treatment.
- **Limitations:** Sun-exposure guidance, not red/NIR PBM-specific.; Medication-category list is conservative and not wavelength-specific.
- **Population mismatch/directness:** Public-health medication screening context only.
- **Artifact/rights status:** unknown.
