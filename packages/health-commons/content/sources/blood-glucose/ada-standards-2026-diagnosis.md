---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:ada-standards-2026-diagnosis
slug: sources/blood-glucose/ada-standards-2026-diagnosis
title: "Diagnosis and Classification of Diabetes: Standards of Care in Diabetes—2026"
summary: "ADA Standards chapter for diabetes classification and diagnostic criteria; used as the current clinical reference boundary for Murph glucose pages."
status: draft
quality: usable
aliases:
  - ada diagnosis classification diabetes 2026
  - dc26-S002
categories:
  - blood-glucose
  - diabetes
  - diagnosis
  - guideline
relations:

  -
    type: cites
    target: biomarker:blood-glucose
source:
  kind: guideline
  title: "Diagnosis and Classification of Diabetes: Standards of Care in Diabetes—2026"
  authors: "American Diabetes Association Professional Practice Committee"
  year: 2026
  journal: "Diabetes Care"
  citation: "American Diabetes Association Professional Practice Committee. Diagnosis and Classification of Diabetes: Standards of Care in Diabetes—2026. Diabetes Care. 2026;49(Supplement 1):S27-S49. doi:10.2337/dc26-S002"
  pmid: "41358893"
  doi: "10.2337/dc26-S002"
  url: https://diabetesjournals.org/care/article/49/Supplement_1/S27/163926/2-Diagnosis-and-Classification-of-Diabetes
researchEvidence:
  designKind: guideline
  designLabel: ADA Standards of Care guideline chapter
  populationLabel: People being screened, classified, or diagnosed for diabetes or prediabetes
  aggregateRole: context
  notes:
    - Clinical guideline source; use for diagnostic-reference boundaries, not for app-driven diagnosis.
evidenceBucket: Clinical diagnostic criteria
whyItMatters: "Keeps Murph's blood glucose page anchored to current ADA diagnostic language while preventing private trend cards from becoming a diagnosis feature."
potentialMurphEndpoints:
  - fasting plasma glucose context labels
  - A1C and OGTT reference boundaries
  - lab-confirmation guardrails
murphTakeaway: "Use as high-authority diagnostic context and as a hard boundary: Murph can explain reference ranges, but clinical diagnosis requires appropriate laboratory testing and medical review."
---

This ADA Standards chapter is a current guideline source for diabetes classification and diagnostic criteria. Murph should use it to explain why fasting plasma glucose, A1C, OGTT, random plasma glucose, home meter readings, and CGM sensor values are not interchangeable.

## Murph use

- Show diagnostic anchors as educational context.
- Avoid diagnosing or classifying users from browser-vault glucose samples.
- Keep laboratory confirmation and clinical review visible whenever diagnostic thresholds are mentioned.
