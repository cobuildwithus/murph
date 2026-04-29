---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct07271927-2026-04-23
slug: sources/whole-body-photobiomodulation/clinicaltrials-gov-nct07271927-2026-04-23
title: Whole-Body Photobiomodulation for Motor and Cognitive Changes in Patients With Parkinson's Disease
summary: Open-label single-arm Parkinson's registry applies about 30 whole-body PBM sessions over 10 weeks and tracks motor, balance, and cognitive outcomes plus safety, but controlled results are not available.
status: draft
quality: usable
aliases:
  - NCT07271927
  - 23-2024-005
categories:
  - whole-body-photobiomodulation
relations:

  -
    type: related_protocol
    target: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
  -
    type: parent_family
    target: experiment_family:whole-body-photobiomodulation
source:
  kind: web_page
  title: Whole-Body Photobiomodulation for Motor and Cognitive Changes in Patients With Parkinson's Disease
  authors: Pusan National University Yangsan Hospital
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Whole-Body Photobiomodulation for Motor and Cognitive Changes in Patients With Parkinson's Disease (NCT07271927). Pusan National University Yangsan Hospital. Registry record accessed 2026-04-23.
  url: https://clinicaltrials.gov/study/NCT07271927
researchEvidence:
  designKind: other
  designLabel: Open-label single-arm interventional trial protocol
  participantCount: 15
  participantCountKind: reported
  populationLabel: Adults aged 40 years or older with Parkinson's disease, Hoehn and Yahr stages 1 to 3, able to walk independently
  durationLabel: Approximately 10 weeks, 20 minutes per session, 3 times per week, total 30 sessions
  aggregateRole: primary
  cohortKey: nct07271927-parkinsons-disease
evidenceBucket: Emerging disease-specific whole-body PBM variants
whyItMatters: Shows that whole-body PBM is being tested in Parkinson's disease with explicit motor and cognitive outcome batteries and a safety frame, extending recall into neurologic disease.
potentialMurphEndpoints:
  - UPDRS
  - BBS
  - grip strength
  - pinch strength
  - functional reach test
  - Timed Up and Go
  - SVLT
  - RCFT
  - DST
  - TMT
  - K-CWST
protocolTakeaway: Keep as neurologic supervised context only; it is not controlled efficacy evidence.
murphTakeaway: Useful for tracking neurologic endpoints and exclusion logic in supervised disease settings, but not for direct protocol claims.
studyDesign: Open-label single-arm interventional protocol
modality: Whole-body photobiomodulation therapy in Parkinson's disease
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **Emerging disease-specific whole-body PBM variants**.

**Findings:** This Parkinson's disease registry is described as an open-label, single-arm interventional study enrolling 15 participants. The planned intervention is whole-body PBM once daily for 20 minutes per session, three times per week, for approximately 10 weeks, totaling 30 sessions. Primary outcome is UPDRS, with secondary outcomes spanning balance, strength, gait/functional mobility, and a cognitive battery including SVLT, RCFT, DST, TMT, and K-CWST. Because there is no placebo group and no posted results, the source belongs in context-only use despite its high relevance for neurologic endpoint recall.

The registry also contributes safety-screening context because the population is a supervised Parkinson's cohort rather than an ordinary wellness sample, and neurologic or neuropsychiatric boundaries should not be generalized into unsupervised use.

**Why it matters:** It helps Murph track how whole-body PBM is being paired with neurologic motor and cognitive outcomes in a symptomatic disease cohort.

**Potential experiment signals:** UPDRS, BBS, grip strength, pinch strength, functional reach test, Timed Up and Go, SVLT, RCFT, DST, TMT, K-CWST

**Protocol takeaway:** Treat as supervised Parkinson's disease context only. It is useful for endpoint and safety mapping, not for efficacy claims.

**Claim use:** `context-only`.
