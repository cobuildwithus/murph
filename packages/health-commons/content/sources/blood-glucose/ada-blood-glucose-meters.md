---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:ada-blood-glucose-meters
slug: sources/blood-glucose/ada-blood-glucose-meters
title: Blood Glucose Meters Can Play an Important Role in Diabetes Care
summary: "ADA device-education page describing blood glucose meters, whole-blood test strips, accuracy expectations, and CGM-confirmation use."
status: draft
quality: usable
aliases:
  - ada blood glucose meters
categories:
  - blood-glucose
  - diabetes
  - device
  - monitoring
relations:
  -
    type: cites
    target: biomarker:blood-glucose
source:
  kind: web_page
  title: Blood Glucose Meters Can Play an Important Role in Diabetes Care
  authors: American Diabetes Association
  year: 2026
  url: https://diabetes.org/about-diabetes/devices-technology/blood-glucose-meters-important-role-in-diabetes-care
researchEvidence:
  designKind: guideline
  designLabel: ADA device education page
  populationLabel: People using blood glucose meters or CGMs
  aggregateRole: context
  notes:
    - Device-context source for meter accuracy and confirmatory checks.
evidenceBucket: Device and measurement method caveat
whyItMatters: "Supports product language that meter, CGM, and lab glucose values need method labels and are not perfect measurements."
potentialMurphEndpoints:
  - device method labeling
  - meter confirmation warnings
  - strip handling context
murphTakeaway: "Use to justify device confidence labels and confirmatory meter-check prompts when CGM readings and symptoms do not match."
---

This ADA page supports practical method copy for glucose meters. Murph should not present any single home reading as perfectly precise, and it should keep device and strip context visible.
