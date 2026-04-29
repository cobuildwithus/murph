---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-noninvasive-glucose-wearable-warning-2024
slug: sources/blood-glucose/fda-noninvasive-glucose-wearable-warning-2024
title: "Do Not Use Smartwatches or Smart Rings to Measure Blood Glucose Levels: FDA Safety Communication"
summary: "FDA safety communication warning that no smartwatch or smart ring has been authorized, cleared, or approved to measure glucose on its own without piercing the skin."
status: draft
quality: usable
aliases:
  - fda smartwatch ring glucose warning 2024
categories:
  - blood-glucose
  - device
  - safety
  - noninvasive-wearables
relations:

  -
    type: cites
    target: biomarker:blood-glucose
source:
  kind: web_page
  title: "Do Not Use Smartwatches or Smart Rings to Measure Blood Glucose Levels: FDA Safety Communication"
  authors: U.S. Food and Drug Administration
  year: 2024
  url: https://www.fda.gov/medical-devices/safety-communications/do-not-use-smartwatches-or-smart-rings-measure-blood-glucose-levels-fda-safety-communication
researchEvidence:
  designKind: guideline
  designLabel: FDA safety communication
  populationLabel: Consumers considering noninvasive glucose claims from smartwatches or smart rings
  aggregateRole: context
  notes:
    - Safety communication; not an efficacy study.
evidenceBucket: Device safety and unauthorized noninvasive claims
whyItMatters: "Prevents Murph from accepting or promoting ring-only or watch-only glucose claims as validated glucose data."
potentialMurphEndpoints:
  - source validation
  - unsupported device warnings
  - glucose device confidence labels
murphTakeaway: "Do not treat unauthorized smartwatch or smart-ring-only glucose claims as reliable glucose measurements."
---

This FDA safety communication is a product guardrail. Murph should not add noninvasive smartwatch or smart-ring glucose claims as if they are equivalent to approved meters or CGMs.
