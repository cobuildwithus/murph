---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:niddk-diabetes-prediabetes-tests
slug: sources/blood-glucose/niddk-diabetes-prediabetes-tests
title: Diabetes & Prediabetes Tests
summary: "NIDDK professional testing page emphasizing lab-test requirements, fasting sample context, FPG/OGTT thresholds, and meter-result limitations for diagnosis."
status: draft
quality: usable
aliases:
  - niddk diabetes prediabetes tests
categories:
  - blood-glucose
  - diabetes
  - diagnosis
  - professional-reference
relations:

  -
    type: cites
    target: biomarker:blood-glucose
source:
  kind: web_page
  title: Diabetes & Prediabetes Tests
  authors: National Institute of Diabetes and Digestive and Kidney Diseases
  year: 2025
  url: https://www.niddk.nih.gov/health-information/professionals/clinical-tools-patient-management/diabetes/diabetes-prediabetes
researchEvidence:
  designKind: guideline
  designLabel: NIDDK professional clinical-tool page
  populationLabel: Health professionals evaluating diabetes and prediabetes tests
  aggregateRole: context
  notes:
    - Highlights that diagnosis requires a laboratory test and that meter results are not suitable for diagnosis.
evidenceBucket: Laboratory testing and method boundary
whyItMatters: "Provides method-specific details that help Murph distinguish lab diagnosis from private self-tracking."
potentialMurphEndpoints:
  - lab versus meter method labels
  - fasting sample context
  - threshold reference copy
murphTakeaway: "Use as a guardrail source: browser-vault glucose samples can support trends, but diagnosis requires appropriate laboratory testing."
---

This NIDDK page is a core method-boundary source. It is the clearest source in this set for saying that diabetes diagnosis requires a lab test and that meter results are not suitable for diagnosis.
