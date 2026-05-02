---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:skin-texture-roughness-score"
slug: "biomarkers/skin-texture-roughness-score"
title: "Skin Texture / Roughness Score"
summary: "A practical score for perceived facial roughness, smoothness, or texture uniformity using a fixed rubric and standardized photos."
status: "draft"
quality: "usable"
aliases:
  - "skin roughness score"
  - "facial texture score"
  - "smoothness score"
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
    target: "source_artifact:pmid-32649063"
  -
    type: "cites"
    target: "source_artifact:pmid-24286286"
  -
    type: "cites"
    target: "source_artifact:doi-10.3390-cosmetics12010004"
  -
    type: "cites"
    target: "source_artifact:pmid-17566756"
measurementContexts:
  - "standardized_photo"
  - "self_rating"
unit: "0-10 score"
interpretationFrame:
  principle: "Compare repeated baseline and intervention windows using the same camera, lighting, region, expression, and scoring rule."
  caveat: "This is a practical self-experiment proxy, not a dermatologist diagnosis or a validated clinical trial endpoint in the individual user."
biomarker:
  shortName: "Skin Texture / Roughness Score"
  displayName: "Skin Texture / Roughness Score"
  unit: "0-10 score"
  valuePrecision: 0
  direction:
    desired: "lower_or_stable"
    label: "Lower usually means less visible roughness or texture irregularity on the chosen rubric."
    nuance: "Self-rated texture is vulnerable to skincare changes, exfoliation, hydration, lighting, and expectation effects."
  trendDefaults:
    latestWindowDays: 42
    comparisonWindowDays: 14
    minimumPoints: 2
    aggregation: "median"
  explainerCards:

    -
      title: "What it is"
      body: "A practical score for perceived facial roughness, smoothness, or texture uniformity using a fixed rubric and standardized photos."
    -
      title: "How to use it"
      body: "Use it as a before-and-after region score across a predefined baseline and intervention window, then review adherence and confounders before interpreting any change."
  measurement:
    bestContext: "Instrumented profilometry or validated imaging is strongest; fixed photos and a repeated self-rating serve as a pragmatic proxy."
    howToMeasure:
      - "Define the treated facial regions and a 0-10 texture rubric before starting."
      - "Rate texture at baseline and scheduled checkpoints, not after every session."
      - "Keep cleansers, actives, exfoliation, retinoids, peels, and procedures stable or explicitly logged."
    confounders:
      - "retinoids or acids"
      - "exfoliation"
      - "hydration"
      - "lighting"
      - "makeup"
      - "sun exposure"
      - "recent procedure"
      - "seasonal dryness"
communityOutcomeSummary:
  state: "coming_soon"
  minimumCohortSize: 30
  placeholder: "Outcome summaries will appear only after enough opted-in runs use comparable photo workflow, adherence logs, and safety reporting."
---

Skin texture and roughness belong in the secondary outcome stack because several facial or adjacent red/NIR/LED studies report texture, roughness, smoothness, or elasticity-related measures, while the methods are heterogeneous.
