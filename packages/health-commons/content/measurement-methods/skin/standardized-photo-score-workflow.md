---
schemaVersion: "murph.commons.page.v1"
entityType: "measurement_method"
key: "measurement_method:skin/standardized-photo-score-workflow"
slug: "measurement-methods/skin/standardized-photo-score-workflow"
title: "Standardized Photo Score Workflow"
summary: "A low-burden home method for comparing facial or periocular skin photos with the same camera, lighting, region, expression, and scoring rubric across baseline and follow-up checkpoints."
status: "draft"
quality: "usable"
aliases:
  - "home skin photo score workflow"
  - "standardized facial photo scoring"
  - "skin photo before after score"
categories:
  - "skin"
  - "photoaging"
  - "measurement-method"
  - "standardized-photo"
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
  -
    type: "cites"
    target: "source_artifact:pmid-39960921"
  -
    type: "cites"
    target: "source_artifact:pmid-32649063"
  -
    type: "cites"
    target: "source_artifact:doi-10.3390-cosmetics12010004"
  -
    type: "cites"
    target: "source_artifact:pmid-15909229"
measurementMethod:
  shortName: "Photo Score Workflow"
  displayName: "Standardized Photo Score Workflow"
  tier: "default_home"
  modalities:
    - "standardized_photo"
    - "self_rating"
  measuredBiomarkerKeys:
    - "biomarker:standardized-skin-photo-score"
    - "biomarker:periocular-wrinkle-score"
    - "biomarker:skin-texture-roughness-score"
    - "biomarker:skin-tolerability-symptoms"
  outputs:
    -
      outputId: "standardized_skin_photo_score"
      label: "Standardized skin photo score"
      valueType: "score"
      unit: "0-10 score"
      mapsToBiomarkerKey: "biomarker:standardized-skin-photo-score"
      direction: "lower_or_stable"
      notes:
        - "Primary starter outcome; use the same region and rubric across baseline, week 4, and week 6."
    -
      outputId: "periocular_wrinkle_score"
      label: "Periocular wrinkle score"
      valueType: "score"
      unit: "0-10 score"
      mapsToBiomarkerKey: "biomarker:periocular-wrinkle-score"
      direction: "lower_or_stable"
      notes:
        - "Use only when the crow's-feet or periocular region is part of the treatment and photo plan."
    -
      outputId: "skin_texture_roughness_score"
      label: "Skin texture / roughness score"
      valueType: "score"
      unit: "0-10 score"
      mapsToBiomarkerKey: "biomarker:skin-texture-roughness-score"
      direction: "lower_or_stable"
      notes:
        - "Score texture from scheduled checkpoint photos, not from first-session glow or skin feel."
    -
      outputId: "skin_eye_tolerability_log"
      label: "Skin and eye tolerability log"
      valueType: "symptom_log"
      unit: "symptom log"
      mapsToBiomarkerKey: "biomarker:skin-tolerability-symptoms"
      direction: "lower_or_stable"
      notes:
        - "Safety output; any eye symptom, painful irritation, blistering, or pigment worsening outranks efficacy interpretation."
  procedure:
    summary: "Pre-specify face regions, take baseline photos before the first intervention session, repeat the same photos at checkpoints, and score only the planned regions with adherence and confounders visible."
    materials:
      - "same camera or phone"
      - "fixed lighting and background"
      - "distance or tripod reference"
      - "predefined scoring rubric"
      - "private storage for identifiable photos"
    steps:
      - "Choose the treated region and score targets before starting, such as whole-face photoaging impression, crow's-feet, or cheek texture."
      - "Take baseline photos with the same camera, distance, lighting, background, expression, and makeup or sunscreen rule planned for follow-up."
      - "Repeat the photo set at week 4 and week 6, then score the same regions without changing the rubric."
      - "Review adherence, skincare changes, sun exposure, illness, sleep, procedures, lighting drift, and tolerability symptoms before interpreting any score movement."
    schedule:
      - "Baseline during the 14-day run-in."
      - "Follow-up at week 4 and week 6 for the starter protocol."
  fidelity:
    minimumRequirements:
      - "Same camera, lighting, distance, background, expression rule, region, and scoring rubric across all checkpoints."
      - "No new skincare actives, peels, cosmetic procedures, or major sun-exposure changes unless they are explicitly logged as confounders."
    repeatabilityRisks:
      - "lighting changes"
      - "camera processing"
      - "expression drift"
      - "makeup or sunscreen changes"
      - "expectation bias"
      - "recent procedures"
  privacy:
    containsIdentifiableImages: true
    localOnlyRecommended: true
    notes:
      - "Keep original face photos private and local by default; use derived scores or cropped regions for sharing unless identifiable photos are intentionally shared."
  burden:
    userBurden: "low"
    costTier: "free"
  confounders:
    - "lighting changes"
    - "camera processing"
    - "makeup or sunscreen"
    - "expression"
    - "skincare changes"
    - "recent procedures"
    - "sun exposure"
    - "expectation bias"
  interpretation:
    principle: "Use the method as a repeated within-person comparison of the same visible skin regions."
    caveat: "This method is a practical personal trend proxy, not a dermatologist diagnosis and not proof of rejuvenation."
---

This is the default measurement method for the skin PBM starter because it keeps burden low and keeps safety symptoms visible. Optional image analysis or clinic imaging can add precision, but they should not be required for a normal home experiment.
