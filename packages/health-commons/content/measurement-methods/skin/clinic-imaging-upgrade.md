---
schemaVersion: "murph.commons.page.v1"
entityType: "measurement_method"
key: "measurement_method:skin/clinic-imaging-upgrade"
slug: "measurement-methods/skin/clinic-imaging-upgrade"
title: "Clinic Imaging Upgrade"
summary: "A higher-burden upgrade path for clinic or research-grade photoaging scales, 3D/profilometry, colorimetry, or controlled imaging when those measurements are already available or intentionally chosen."
status: "draft"
quality: "stub"
aliases:
  - "clinic skin imaging"
  - "validated photoaging scale review"
  - "skin profilometry upgrade"
categories:
  - "skin"
  - "photoaging"
  - "measurement-method"
  - "clinic"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging"
  -
    type: "measures"
    target: "biomarker:standardized-skin-photo-score"
  -
    type: "measures"
    target: "biomarker:periocular-wrinkle-score"
  -
    type: "measures"
    target: "biomarker:skin-texture-roughness-score"
  -
    type: "safety_outcome"
    target: "biomarker:skin-tolerability-symptoms"
measurementMethod:
  shortName: "Clinic Imaging Upgrade"
  displayName: "Clinic Imaging Upgrade"
  tier: "clinic"
  modalities:
    - "clinical_scale"
    - "instrumented_imaging"
    - "biophysical_device"
    - "colorimetry"
  measuredBiomarkerKeys:
    - "biomarker:standardized-skin-photo-score"
    - "biomarker:periocular-wrinkle-score"
    - "biomarker:skin-texture-roughness-score"
    - "biomarker:skin-tolerability-symptoms"
  outputs:

    -
      outputId: "blinded_clinical_photoaging_scale"
      label: "Blinded clinical photoaging scale"
      valueType: "score"
      unit: "scale-specific score"
      mapsToBiomarkerKey: "biomarker:standardized-skin-photo-score"
      direction: "lower_or_stable"
      notes:
        - "Use a named scale and the same reviewer/blinding approach across checkpoints when possible."
    -
      outputId: "clinic_wrinkle_or_profilometry_score"
      label: "Clinic wrinkle or profilometry score"
      valueType: "number"
      unit: "device-specific score"
      mapsToBiomarkerKey: "biomarker:periocular-wrinkle-score"
      direction: "lower_or_stable"
      notes:
        - "Use only for the same treated region and the same instrument settings across baseline and follow-up."
    -
      outputId: "clinic_texture_or_roughness_index"
      label: "Clinic texture or roughness index"
      valueType: "index"
      unit: "device-specific index"
      mapsToBiomarkerKey: "biomarker:skin-texture-roughness-score"
      direction: "lower_or_stable"
      notes:
        - "Keep the clinic/device protocol stable; do not mix device families in one run."
    -
      outputId: "clinician_tolerability_review"
      label: "Clinician tolerability review"
      valueType: "symptom_log"
      unit: "review note"
      mapsToBiomarkerKey: "biomarker:skin-tolerability-symptoms"
      direction: "lower_or_stable"
      notes:
        - "Use as a safety review, especially when symptoms, pigment change, eye concerns, procedures, or medications complicate interpretation."
  procedure:
    summary: "Use the clinic or research method as an upgrade only when it is available without turning the starter protocol into a high-cost measurement project."
    materials:
      - "named clinic imaging or scale protocol"
      - "same device or reviewer across checkpoints"
      - "baseline and follow-up appointments"
    steps:
      - "Record the exact instrument, scale, reviewer/blinding status, anatomical region, settings, and date for each checkpoint."
      - "Keep the home protocol and skincare/procedure context stable enough that clinic outputs can be interpreted."
      - "Compare baseline and follow-up with the same clinic method; do not combine unrelated imaging systems into one trend."
      - "Review skin and eye tolerability before treating favorable imaging changes as useful."
    schedule:
      - "Use at baseline and the planned endpoint when clinic access already exists or the user intentionally chooses the upgrade."
  fidelity:
    minimumRequirements:
      - "Same instrument or named scale, same anatomical region, same checkpoint timing, and clear documentation of reviewer or device settings."
    repeatabilityRisks:
      - "different imaging system"
      - "different reviewer"
      - "device settings drift"
      - "procedure or skincare changes"
      - "appointment timing drift"
  privacy:
    containsIdentifiableImages: true
    localOnlyRecommended: true
    notes:
      - "Clinic images and reports may contain identifying medical information; store only the minimum useful outputs in Murph unless the user intentionally imports more."
  burden:
    userBurden: "high"
    costTier: "clinic"
  confounders:
    - "different imaging system"
    - "different reviewer"
    - "procedures"
    - "skincare changes"
    - "sun exposure"
    - "makeup"
    - "timing drift"
  interpretation:
    principle: "Use clinic data to strengthen a run only when the measurement method is stable and the extra burden is intentional."
    caveat: "This is an upgrade path, not a default requirement, and it should not make a simple home PBM experiment feel clinically mandatory."
---

This placeholder keeps the protocol able to reference a clinic or scale upgrade without requiring one. More detailed clinic-method pages can replace it when a specific validated scale or instrument becomes part of a protocol fork.
