---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:cdc-low-blood-sugar-2024
slug: sources/blood-glucose/cdc-low-blood-sugar-2024
title: Low Blood Sugar (Hypoglycemia)
summary: "CDC hypoglycemia education page defining low blood sugar below 70 mg/dL and emphasizing that lows can be dangerous if untreated."
status: draft
quality: usable
aliases:
  - cdc hypoglycemia low blood sugar
categories:
  - blood-glucose
  - diabetes
  - hypoglycemia
  - safety
relations:
  -
    type: cites
    target: biomarker:blood-glucose
source:
  kind: web_page
  title: Low Blood Sugar (Hypoglycemia)
  authors: Centers for Disease Control and Prevention
  year: 2024
  url: https://www.cdc.gov/diabetes/about/low-blood-sugar-hypoglycemia.html
researchEvidence:
  designKind: guideline
  designLabel: CDC hypoglycemia patient-education page
  populationLabel: People at risk of hypoglycemia, especially people with diabetes
  aggregateRole: context
  notes:
    - Safety-focused patient education, not an efficacy study.
evidenceBucket: Hypoglycemia safety boundary
whyItMatters: "Prevents Murph from treating lower glucose as always better and supports visible low-glucose warnings."
potentialMurphEndpoints:
  - low-glucose safety copy
  - symptom mismatch warnings
  - clinician-plan reminders
murphTakeaway: "Use as a high-priority safety source for low glucose. A low reading is an action signal, not a performance win."
---

This CDC hypoglycemia page supports the safety boundary for Murph's glucose biomarker. The product should never reward hypoglycemia or make low glucose look like an optimization success.
