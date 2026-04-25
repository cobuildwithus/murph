---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:standardized-skin-photo-score"
slug: "biomarkers/standardized-skin-photo-score"
title: "Standardized Skin Photo Score"
summary: "A same-camera, same-lighting before-and-after photo score for facial texture, pores, pigment appearance, and overall photoaging impression."
status: "draft"
quality: "usable"
aliases:
  - "skin photo score"
  - "facial photo score"
  - "photoaging photo score"
categories:
  - "skin"
  - "photoaging"
  - "self-assessment"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging"
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
  -
    type: "cites"
    target: "source_artifact:pmid-41032498"
measurementContexts:
  - "standardized_photo"
  - "self_rating"
unit: "0-10 score"
interpretationFrame:
  principle: "Compare repeated baseline and intervention windows using the same camera, lighting, region, expression, and scoring rule."
  caveat: "This is a practical Murph self-experiment proxy, not a dermatologist diagnosis or a validated clinical trial endpoint in the individual user."
biomarker:
  shortName: "Standardized Skin Photo Score"
  displayName: "Standardized Skin Photo Score"
  unit: "0-10 score"
  valuePrecision: 0
  direction:
    desired: "lower_or_stable"
    label: "Lower usually means less visible texture or photoaging burden on the chosen scoring rubric."
    nuance: "Lighting, pose, expression, cosmetics, camera processing, and expectation bias can move the score more than the intervention."
  trendDefaults:
    latestWindowDays: 42
    comparisonWindowDays: 14
    minimumPoints: 2
    aggregation: "median"
  explainerCards:
    -
      title: "What it is"
      body: "A same-camera, same-lighting before-and-after photo score for facial texture, pores, pigment appearance, and overall photoaging impression."
    -
      title: "How Murph uses it"
      body: "Use it as a before-and-after region score across a predefined baseline and intervention window, then review adherence and confounders before interpreting any change."
  measurement:
    bestContext: "A blinded dermatologist or validated imaging system is strongest; Murph uses standardized self photos only as a low-burden personal trend proxy."
    howToMeasure:
      - "Take baseline photos before starting the intervention and repeat at the same time of day at week 4 and week 6 or later."
      - "Use the same camera, lens, distance, background, lighting, face angle, expression, and no-makeup or same-makeup rule."
      - "Score the same regions each time and review the score with adherence, skincare changes, procedures, illness, travel, and lighting notes visible."
    confounders:
      - "lighting changes"
      - "camera processing"
      - "makeup or sunscreen"
      - "expression"
      - "skincare changes"
      - "recent procedures"
      - "sun exposure"
      - "expectation bias"
communityOutcomeSummary:
  state: "coming_soon"
  minimumCohortSize: 30
  placeholder: "Outcome summaries will appear only after enough opted-in runs use comparable photo workflow, adherence logs, and safety reporting."
---

Standardized skin-photo scoring is the primary Murph-readable signal for this protocol because consumer facial LED/PBM studies rely on visual, photographic, investigator, imaging, or participant-facing skin-appearance outcomes rather than a wearable biomarker. Keep the score humble: it is useful for personal pattern-finding, not for diagnosis or proof of rejuvenation.
