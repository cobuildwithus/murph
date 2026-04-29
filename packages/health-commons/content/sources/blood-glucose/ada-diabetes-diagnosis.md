---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:ada-diabetes-diagnosis
slug: sources/blood-glucose/ada-diabetes-diagnosis
title: Diabetes Diagnosis & Tests
summary: "ADA patient-facing explanation of A1C, fasting plasma glucose, OGTT, random plasma glucose, and repeat-confirmation context."
status: draft
quality: usable
aliases:
  - ada diabetes diagnosis tests
categories:
  - blood-glucose
  - diabetes
  - patient-education
relations:

  -
    type: cites
    target: biomarker:blood-glucose
source:
  kind: web_page
  title: Diabetes Diagnosis & Tests
  authors: American Diabetes Association
  year: 2026
  url: https://diabetes.org/about-diabetes/diagnosis
researchEvidence:
  designKind: guideline
  designLabel: ADA patient education page
  populationLabel: People learning about diabetes testing
  aggregateRole: context
  notes:
    - Patient-facing reference for test types and common diagnostic thresholds.
evidenceBucket: Patient-facing testing reference
whyItMatters: "Gives accessible threshold and repeat-testing context for the blood glucose biomarker page."
potentialMurphEndpoints:
  - fasting glucose explanatory copy
  - OGTT explanatory copy
  - random glucose with symptoms context
murphTakeaway: "Use for plain-language education and route users back to clinical testing rather than app-based diagnosis."
---

The ADA diagnosis page is useful as a plain-language companion to the professional Standards. It explains the major diabetes tests and why one abnormal result is commonly repeated or confirmed.
