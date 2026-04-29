---
schemaVersion: "murph.commons.page.v1"
entityType: "measurement_method"
key: "measurement_method:skin/home-standardized-photo-roi-analysis"
slug: "measurement-methods/skin/home-standardized-photo-roi-analysis"
title: "Home Standardized Photo ROI Analysis"
summary: "An optional home image-analysis method for fixed facial or periocular photo regions of interest, combining wrinkle-line, calibrated-color, and texture-index outputs from the same locked photo workflow."
status: "draft"
quality: "usable"
aliases:
  - "ImageJ skin ROI analysis"
  - "home wrinkle texture image analysis"
  - "calibrated color card skin photo analysis"
categories:
  - "skin"
  - "photoaging"
  - "measurement-method"
  - "image-analysis"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging"
  -
    type: "measures"
    target: "biomarker:periocular-wrinkle-score"
  -
    type: "measures"
    target: "biomarker:skin-texture-roughness-score"
  -
    type: "safety_outcome"
    target: "biomarker:skin-tolerability-symptoms"
  -
    type: "cites"
    target: "source_artifact:pmid-40167796"
  -
    type: "cites"
    target: "source_artifact:pmid-36780572"
  -
    type: "cites"
    target: "source_artifact:pmid-16414908"
  -
    type: "cites"
    target: "source_artifact:pmid-17566756"
  -
    type: "cites"
    target: "source_artifact:doi-10.3390-cosmetics12010004"
  -
    type: "cites"
    target: "source_artifact:pmid-41091280"
  -
    type: "cites"
    target: "source_artifact:pmid-39133416"
  -
    type: "cites"
    target: "source_artifact:pmid-37522497"
  -
    type: "cites"
    target: "source_artifact:pmid-32649063"
  -
    type: "cites"
    target: "source_artifact:pmid-24286286"
measurementMethod:
  shortName: "Home Photo ROI Analysis"
  displayName: "Home Standardized Photo ROI Analysis"
  tier: "optional_home"
  modalities:
    - "standardized_photo"
    - "calibrated_photo"
    - "image_analysis"
  measuredBiomarkerKeys:
    - "biomarker:periocular-wrinkle-score"
    - "biomarker:skin-texture-roughness-score"
  outputs:

    -
      outputId: "wrinkle_line_length_or_area"
      label: "Wrinkle line length or area"
      valueType: "number"
      unit: "normalized line length, area, or percent ROI"
      mapsToBiomarkerKey: "biomarker:periocular-wrinkle-score"
      direction: "lower_or_stable"
      notes:
        - "Companion proxy for the pre-specified periocular or wrinkle region; do not compare raw pixels across cameras, crops, or threshold settings."
    -
      outputId: "calibrated_color_pigment_delta"
      label: "Calibrated color / pigment delta"
      valueType: "number"
      unit: "calibrated color delta or baseline-indexed proxy"
      direction: "mixed_or_contextual"
      notes:
        - "Safety/context proxy for pigment, redness, or brightness drift; intentionally has no mapsToBiomarkerKey until a pigment or erythema outcome exists."
        - "Use this output to flag possible pigment worsening, irritation, sun-exposure confounding, or lighting/calibration drift before interpreting efficacy."
    -
      outputId: "texture_index"
      label: "Texture index"
      valueType: "index"
      unit: "normalized texture index"
      mapsToBiomarkerKey: "biomarker:skin-texture-roughness-score"
      direction: "lower_or_stable"
      notes:
        - "Companion proxy for texture or roughness; focus, lighting angle, hydration, camera sharpening, and threshold settings can dominate small changes."
  procedure:
    summary: "Use the same standardized photo set as the default workflow, then analyze locked regions of interest with one pre-written image-analysis recipe for the whole run."
    materials:
      - "same camera or phone"
      - "fixed lighting and distance reference"
      - "saved ROI crop or template"
      - "ImageJ/Fiji or similar free image-analysis tool"
      - "optional gray card or inexpensive color card"
    steps:
      - "Choose each ROI before starting, such as right crow's-feet, left crow's-feet, glabellar lines, or one cheek texture area."
      - "Use the same camera, distance, lighting, expression, crop, file export, and makeup or sunscreen rule at baseline, week 4, and week 6."
      - "For wrinkle analysis, apply the same crop, grayscale or contrast step, threshold or edge rule, and line-length, line-area, or percent-ROI calculation every time."
      - "For calibrated color analysis, place a gray card or color card in the same plane as the face, lock exposure and white balance when possible, and keep the formula fixed."
      - "For texture analysis, use one formula such as local contrast standard deviation, edge density, or thresholded roughness-like area percentage."
      - "Report within-person normalized or baseline-indexed values, not cross-person comparisons."
      - "Keep original face photos private and local by default; use ROI crops or derived measurements for analysis or sharing unless identifiable photos are intentionally shared."
    schedule:
      - "Use at baseline, week 4, and week 6 only when the add-on path is selected before the run."
  fidelity:
    minimumRequirements:
      - "ROI templates, lighting, camera, crop, file export, calibration, and analysis formulas must be locked before the baseline-to-follow-up comparison."
      - "The color output needs a visible gray card or color card if it is interpreted as calibrated rather than descriptive context."
    repeatabilityRisks:
      - "expression or squinting"
      - "camera distance"
      - "lighting angle or spectrum"
      - "focus drift"
      - "auto white balance"
      - "crop or ROI drift"
      - "threshold settings"
      - "image compression"
      - "makeup or sunscreen"
      - "skin hydration"
      - "recent procedures"
    calibration:
      - "Use a gray card or color card for color outputs; do not switch card placement, white-balance handling, or color formula mid-run."
      - "Save the ImageJ/Fiji workflow and ROI template so the analysis can be rerun or blinded later."
  privacy:
    containsIdentifiableImages: true
    localOnlyRecommended: true
    notes:
      - "Original face photos are identifiable health-adjacent media. Keep them private and strip metadata where practical."
      - "Prefer ROI crops or derived values for review and sharing."
  burden:
    userBurden: "moderate"
    costTier: "low_cost"
  confounders:
    - "expression or squinting"
    - "camera distance"
    - "lighting angle"
    - "auto white balance"
    - "focus drift"
    - "crop or ROI drift"
    - "threshold settings"
    - "image compression"
    - "makeup or sunscreen"
    - "skin hydration"
    - "sun exposure"
    - "retinoids or acids"
    - "recent procedures"
  interpretation:
    principle: "Compare the same ROI within the same person using one locked workflow, then interpret only alongside the default photo scores, adherence, confounders, and tolerability symptoms."
    caveat: "This method is more quantifiable than a visual score but remains a personal photo proxy, not a validated clinical endpoint."
---

Home ROI analysis is an optional add-on for users who want more structure than a photo score and can keep the workflow stable. The calibrated-color output is deliberately a safety/context signal here because this protocol does not yet define a first-class pigment or erythema outcome.
