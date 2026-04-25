---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:periocular-wrinkle-score"
slug: "biomarkers/periocular-wrinkle-score"
title: "Periocular Wrinkle Score"
summary: "A region-specific score for crow's-feet or periocular line visibility using standardized photos or a consistent self-rating rubric."
status: "draft"
quality: "usable"
aliases:
  - "crow feet score"
  - "crow's-feet score"
  - "periorbital wrinkle score"
  - "under-eye line score"
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
    target: "source_artifact:pmid-36780572"
  -
    type: "cites"
    target: "source_artifact:pmid-39133416"
  -
    type: "cites"
    target: "source_artifact:pmid-32541484"
measurementContexts:
  - "standardized_photo"
  - "self_rating"
unit: "0-10 score"
interpretationFrame:
  principle: "Compare repeated baseline and intervention windows using the same camera, lighting, region, expression, and scoring rule."
  caveat: "This is a practical Murph self-experiment proxy, not a dermatologist diagnosis or a validated clinical trial endpoint in the individual user."
biomarker:
  shortName: "Periocular Wrinkle Score"
  displayName: "Periocular Wrinkle Score"
  unit: "0-10 score"
  valuePrecision: 0
  direction:
    desired: "lower_or_stable"
    label: "Lower usually means less visible periocular line severity on the chosen rubric."
    nuance: "Periocular outcomes do not automatically generalize to the whole face, and eye-safety constraints matter more than chasing eyelid-area exposure."
  trendDefaults:
    latestWindowDays: 42
    comparisonWindowDays: 14
    minimumPoints: 2
    aggregation: "median"
  explainerCards:
    -
      title: "What it is"
      body: "A region-specific score for crow's-feet or periocular line visibility using standardized photos or a consistent self-rating rubric."
    -
      title: "How Murph uses it"
      body: "Use it as a before-and-after region score across a predefined baseline and intervention window, then review adherence and confounders before interpreting any change."
  measurement:
    bestContext: "Use a validated wrinkle scale or investigator photo review when available; Murph uses same-region standardized photos and self-ratings as a personal proxy."
    howToMeasure:
      - "Choose the periocular or crow's-feet region before starting."
      - "Use the same expression rule each time, such as neutral face plus optional standardized smile photo."
      - "Record whether eye inserts, shields, or goggles were used and whether any ocular symptoms occurred."
    confounders:
      - "smiling or squinting"
      - "camera angle"
      - "eye protection displacement"
      - "dry eyes"
      - "makeup"
      - "sleep loss"
      - "recent procedures"
communityOutcomeSummary:
  state: "coming_soon"
  minimumCohortSize: 30
  placeholder: "Outcome summaries will appear only after enough opted-in runs use comparable photo workflow, adherence logs, and safety reporting."
---

Periocular wrinkle scoring is useful because the closest home red/NIR mask RCT focused on crow's-feet. Treat it as a region-specific outcome and keep eye protection non-negotiable.
