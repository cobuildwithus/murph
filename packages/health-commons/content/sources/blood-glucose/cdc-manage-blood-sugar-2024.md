---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:cdc-manage-blood-sugar-2024
slug: sources/blood-glucose/cdc-manage-blood-sugar-2024
title: Manage Blood Sugar
summary: "CDC diabetes-management page with meter/CGM monitoring context, typical target examples, and high/low blood sugar action framing."
status: draft
quality: usable
aliases:
  - cdc manage blood sugar
categories:
  - blood-glucose
  - diabetes
  - patient-education
  - monitoring
relations:

  -
    type: cites
    target: biomarker:blood-glucose
source:
  kind: web_page
  title: Manage Blood Sugar
  authors: Centers for Disease Control and Prevention
  year: 2024
  url: https://www.cdc.gov/diabetes/treatment/index.html
researchEvidence:
  designKind: guideline
  designLabel: CDC diabetes patient-education page
  populationLabel: People managing diabetes
  aggregateRole: context
  notes:
    - Gives typical diabetes target examples while emphasizing individualized targets and care-team guidance.
evidenceBucket: Home monitoring and target examples
whyItMatters: "Anchors common diabetes-management target examples and confirms that home monitoring context depends on individualized care plans."
potentialMurphEndpoints:
  - pre-meal target context
  - post-meal target context
  - meter and CGM method copy
  - sick-day context
murphTakeaway: "Use as plain-language monitoring context. Targets should be labeled as typical diabetes-management examples, not universal optimization goals."
---

This CDC page is used for home-monitoring language, typical diabetes target examples, and the need to personalize targets with a health care team.
