---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:image-derived-skin-texture-index"
slug: "biomarkers/image-derived-skin-texture-index"
title: "Image-Derived Skin Texture Index"
summary: "A low-cost image-analysis proxy for skin texture in a fixed ROI, using same-camera macro or close photos and a pre-specified ImageJ/Fiji local-contrast, edge-density, or roughness-style calculation."
status: "draft"
quality: "usable"
aliases:
  - "skin texture image analysis"
  - "image-derived roughness proxy"
  - "texture edge density"
  - "local contrast skin texture"
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
    target: "source_artifact:pmid-32649063"
  -
    type: "cites"
    target: "source_artifact:pmid-24286286"
  -
    type: "cites"
    target: "source_artifact:pmid-41032498"
measurementContexts:
  - "standardized_photo"
  - "macro_photo"
  - "image_analysis"
unit: "normalized texture index"
interpretationFrame:
  principle: "Compare a pre-specified texture index in the same ROI across baseline and intervention checkpoints using the same camera, lighting geometry, focus, crop, and analysis settings."
  caveat: "This is distinct from a subjective roughness score, but it is still a photo-derived personal trend proxy rather than a validated clinical profilometry endpoint."
biomarker:
  shortName: "Image-Derived Skin Texture Index"
  displayName: "Image-Derived Skin Texture Index"
  unit: "normalized texture index"
  valuePrecision: 2
  direction:
    desired: "lower_or_stable"
    label: "Lower usually means less local contrast, edge density, or roughness-like signal in the chosen ROI and workflow."
    nuance: "Focus, lighting angle, shadows, skin hydration, thresholding, and camera sharpening can move the index more than the intervention."
  trendDefaults:
    latestWindowDays: 42
    comparisonWindowDays: 14
    minimumPoints: 2
    aggregation: "median"
  explainerCards:
    -
      title: "What it is"
      body: "A fixed-ROI image-analysis texture proxy, such as local contrast or edge density, computed from standardized close or macro photos."
    -
      title: "How Murph uses it"
      body: "Use it as a more quantifiable companion to the subjective texture score while keeping the same safety, adherence, and confounder checks visible."
  measurement:
    bestContext: "Instrumented profilometry or controlled imaging is stronger; Murph's low-cost user method is a fixed macro/close photo or oblique-light photo analyzed with ImageJ/Fiji or similar free tools."
    howToMeasure:
      - "Choose one small ROI before starting, such as a cheek texture area, and avoid mixing cheek, forehead, and periocular regions in the same metric."
      - "Use the same camera, focus distance, lighting angle, face position, crop/template, and file-export settings at baseline, week 4, and week 6."
      - "Pick one formula before starting, such as local contrast standard deviation, edge density, or a thresholded roughness-like area percentage, and apply it identically to every image."
      - "Use baseline-indexed or ROI-normalized values, not cross-person comparisons or raw camera-dependent scores."
      - "Record whether photos were taken after washing, moisturizing, shaving, exfoliation, sweating, or a treatment session because surface hydration and shadows can dominate the signal."
      - "Keep original face photos private and local by default, strip metadata where practical, and use ROI crops or derived texture values for analysis or sharing unless identifiable photos are intentionally shared."
    confounders:
      - "focus drift"
      - "lighting angle"
      - "camera sharpening"
      - "skin hydration"
      - "moisturizer or sunscreen"
      - "exfoliation"
      - "retinoids or acids"
      - "sweat or oil"
      - "ROI drift"
      - "threshold settings"
      - "recent procedures"
communityOutcomeSummary:
  state: "coming_soon"
  minimumCohortSize: 30
  placeholder: "Outcome summaries will appear only after enough opted-in runs use comparable macro or close-photo workflows, ROI templates, ImageJ/Fiji settings, adherence logs, and safety reporting."
---

Image-derived texture indexing gives this protocol a more quantifiable texture signal without requiring professional devices. It should be interpreted as a within-person trend only, and any skin or eye tolerability issue remains more important than a favorable texture index.
