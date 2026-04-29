---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-pulse-oximeter-basics-2025
slug: sources/spo2/fda-pulse-oximeter-basics-2025
title: "FDA Pulse Oximeter Basics"
summary: "FDA consumer guidance on home pulse-oximeter use, symptom context, measurement technique, accuracy limitations, and the distinction between medical devices and general-wellness products."
status: field-testing
quality: usable
categories:
  - spo2
  - pulse-oximetry
  - device-accuracy
  - home-monitoring
relations:

  -
    type: measures
    target: biomarker:blood-oxygen-spo2
source:
  kind: web_page
  title: "Pulse Oximeter Basics"
  authors: "U.S. Food and Drug Administration"
  year: 2025
  journal: "FDA Consumer Updates"
  citation: "U.S. Food and Drug Administration. Pulse Oximeter Basics. FDA Consumer Updates. Content current as of 2025-03-26."
  url: https://www.fda.gov/consumers/consumer-updates/pulse-oximeter-basics
researchEvidence:
  designKind: guideline
  designLabel: "Consumer medical-device guidance"
  populationLabel: "Consumers and patients using pulse oximeters at home"
  aggregateRole: context
evidenceBucket: "Measurement technique and consumer-device limits"
whyItMatters: "Anchors Murph's home-use instructions: interpret readings alongside symptoms, measure carefully, and do not treat general-wellness devices as clinical decision tools."
potentialMurphEndpoints:
  - SpO₂ spot checks
  - overnight SpO₂ trend context
  - respiratory symptoms and safety notes
murphTakeaway: "Use FDA technique and caveats whenever displaying SpO₂: same context, steady reading, symptom context, and explicit device-limit language."
studyDesign: "Regulatory consumer guidance"
modality: "Pulse oximetry and home oxygen-saturation monitoring"
murphV1Priority: High
---

The FDA page is the practical measurement anchor for Murph's SpO₂ biomarker page.

It emphasizes that home pulse-oximeter readings should be interpreted with how the user feels, that a careful reading requires stillness and device-specific instructions, and that accuracy can be affected by perfusion, temperature, smoking exposure, fingernail polish, and skin pigmentation.

It also separates medical pulse oximeters from general-wellness or sport products that are not evaluated by FDA for clinical decision-making.
