---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct01492361-2026-04-25
slug: sources/omega-3-supplementation/clinicaltrials-nct01492361-2026-04-25
title: Reduction of Cardiovascular Events With Icosapent Ethyl-Intervention Trial (REDUCE-IT)
summary: ClinicalTrials.gov registry anchor for REDUCE-IT, included to document prescription EPA-only design, population, dosing, and cardiovascular-outcomes boundary.
status: draft
quality: usable
aliases:
- REDUCE-IT registry
- NCT01492361
categories:
- omega-3-supplementation
relations:
-
  type: related_protocol
  target: protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation
-
  type: parent_family
  target: experiment_family:omega-3-supplementation
source:
  kind: other
  title: A Study of AMR101 to Evaluate Its Ability to Reduce Cardiovascular Events in High-Risk Patients With Hypertriglyceridemia and on Statin (REDUCE-IT)
  authors: Amarin Pharma Inc
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. A Study of AMR101 to Evaluate Its Ability to Reduce Cardiovascular Events in High-Risk Patients With Hypertriglyceridemia and on Statin (REDUCE-IT). NCT01492361. Accessed 2026-04-25.
  url: https://clinicaltrials.gov/study/NCT01492361
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Trial registry record for randomized double-blind placebo-controlled phase 3b cardiovascular outcomes trial
  participantCount: 8179
  participantCountKind: reported
  populationLabel: Statin-treated patients with established cardiovascular disease or diabetes plus additional risk factors and elevated triglycerides
  durationLabel: Long-term cardiovascular outcomes trial; published median follow-up 4.9 years
  aggregateRole: context
  cohortKey: reduce-it-registry-nct01492361
evidenceBucket: clinical_cardiovascular_lipid_boundary
whyItMatters: Anchors the population, product, dose, and endpoint boundary for a major EPA-only prescription trial.
potentialMurphEndpoints:
- MACE composite
- CV death
- nonfatal MI
- nonfatal stroke
- coronary revascularization
- unstable angina
- atrial fibrillation
- bleeding
protocolTakeaway: REDUCE-IT is not a routine EPA+DHA supplement trial; use only for prescription EPA-only boundary context unless citing the outcome paper directly.
murphTakeaway: Useful registry anchor for product/dose/population distinctions around icosapent ethyl.
studyDesign: Trial registry record for randomized controlled trial
modality: icosapent ethyl 4 g/day added to statin therapy
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---
This source is included for **clinical_cardiovascular_lipid_boundary**.

**Findings:**
- The registry record anchors REDUCE-IT as a phase 3b randomized, double-blind, placebo-controlled, parallel-group trial of AMR101/icosapent ethyl in high-risk statin-treated patients with elevated triglycerides.
- The trial compared icosapent ethyl 4 g/day with placebo and used a cardiovascular composite endpoint including cardiovascular death, nonfatal MI, nonfatal stroke, coronary revascularization, and unstable angina.
- Because this is a registry source, the extraction records design and boundary details only; efficacy results should be tied to the published outcome paper, not this page alone.

**Why it matters:** Anchors the population, product, dose, and endpoint boundary for a major EPA-only prescription trial.

**Potential experiment signals:** MACE composite; CV death; nonfatal MI; stroke; revascularization; unstable angina; AF and bleeding safety in linked outcome publications.

**Protocol takeaway:** REDUCE-IT is not a routine EPA+DHA supplement trial; use only for prescription EPA-only boundary context unless citing the outcome paper directly.

**Claim use:** `context-only`.
