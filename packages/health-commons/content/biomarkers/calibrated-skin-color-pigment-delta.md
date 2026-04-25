---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:calibrated-skin-color-pigment-delta"
slug: "biomarkers/calibrated-skin-color-pigment-delta"
title: "Calibrated Skin Color / Pigment Delta"
summary: "A low-cost calibrated-photo proxy for change in a fixed cheek, periocular, or pigment ROI using the same lighting plus a gray card or color card to track L*a*b*, RGB-derived brightness/redness/brownness, or conservative color delta."
status: "draft"
quality: "usable"
aliases:
  - "skin color delta"
  - "pigment photo delta"
  - "calibrated color card skin photo"
  - "brightness redness brownness proxy"
categories:
  - "skin"
  - "photoaging"
  - "image-analysis"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging"
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
measurementContexts:
  - "standardized_photo"
  - "calibrated_photo"
  - "image_analysis"
unit: "calibrated color delta or baseline-indexed proxy"
interpretationFrame:
  principle: "Compare the same ROI across baseline and intervention checkpoints only after controlling camera, lighting, white balance, color-card reference, skincare, and sun-exposure context."
  caveat: "This is a conservative personal trend proxy for color appearance, not a diagnosis of pigment disease and not proof that red/NIR changed melanin, hemoglobin, or photoaging biology."
biomarker:
  shortName: "Calibrated Skin Color / Pigment Delta"
  displayName: "Calibrated Skin Color / Pigment Delta"
  unit: "calibrated color delta or baseline-indexed proxy"
  valuePrecision: 2
  direction:
    desired: "mixed_or_contextual"
    label: "Context matters: lower unwanted redness or brownness may be preferred, while brightness or L* changes require the user's pre-specified goal."
    nuance: "Phone processing, auto white balance, sun exposure, inflammation, melasma risk, and skincare changes can dominate small color shifts."
  trendDefaults:
    latestWindowDays: 42
    comparisonWindowDays: 14
    minimumPoints: 2
    aggregation: "median"
  explainerCards:
    -
      title: "What it is"
      body: "A fixed-ROI color trend from standardized photos that include a gray card or color card for basic calibration."
    -
      title: "How Murph uses it"
      body: "Use it as an optional secondary signal for pigment or brightness appearance, interpreted alongside standardized photos, sun exposure, skincare changes, and tolerability."
  measurement:
    bestContext: "Research colorimetry or controlled imaging is stronger; Murph's low-cost user method is same-lighting phone photography with a gray card or inexpensive color card and a fixed ROI."
    howToMeasure:
      - "Place a gray card or inexpensive color card in the same plane as the face, outside the treatment ROI but visible in every baseline and follow-up photo."
      - "Lock exposure and white balance when possible, avoid beauty filters and HDR-style processing, and use the same camera, lens, lighting, time of day, and background."
      - "Pre-specify one or two ROIs, such as cheek pigment, periocular discoloration, or a matched cheek control area, and use the same crop/template each time."
      - "Analyze either L*a*b* delta after color correction, or a simpler RGB-derived brightness/redness/brownness proxy, but do not switch formulas mid-run."
      - "Log sun exposure, sunscreen consistency, retinoids/acids, irritation, menstruation-related flushing if relevant, and any new or worsening pigment change."
      - "Keep original face photos private and local by default, strip metadata where practical, and use ROI crops or derived color values for analysis or sharing unless identifiable photos are intentionally shared."
    confounders:
      - "auto white balance"
      - "lighting spectrum"
      - "color-card placement"
      - "sun exposure"
      - "sunscreen or makeup"
      - "retinoids or acids"
      - "irritation or erythema"
      - "melasma or PIH history"
      - "skin hydration"
      - "camera processing"
      - "ROI drift"
communityOutcomeSummary:
  state: "coming_soon"
  minimumCohortSize: 30
  placeholder: "Outcome summaries will appear only after enough opted-in runs use comparable color-card workflows, fixed ROIs, adherence logs, confounder logs, and safety reporting."
---

Calibrated color tracking is most useful when the goal and ROI are chosen before the protocol starts. It should flag possible pigment worsening or irritation as much as possible improvement, and it should never override the protocol's eye and skin stop rules.
