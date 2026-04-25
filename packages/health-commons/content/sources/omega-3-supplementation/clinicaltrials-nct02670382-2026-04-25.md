---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct02670382-2026-04-25
slug: sources/omega-3-supplementation/clinicaltrials-nct02670382-2026-04-25
title: Role of Eicosapentaenoic Acid (EPA) and Docosahexaenoic Acid (DHA) on Inflammation and Lipids
summary: ClinicalTrials.gov registry for EPA and DHA effects on inflammation and lipids in a crossover design.
status: draft
quality: usable
aliases:
- Role of Eicosapentaenoic Acid (EPA) and Docosahexaenoic Acid (DHA) on Inflammation and Lipids
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
  title: Role of Eicosapentaenoic Acid (EPA) and Docosahexaenoic Acid (DHA) on Inflammation and Lipids
  authors: Tufts University / ClinicalTrials.gov registry
  year: 2026
  journal: ClinicalTrials.gov
  citation: Tufts University / ClinicalTrials.gov registry. Role of Eicosapentaenoic Acid (EPA) and Docosahexaenoic Acid (DHA) on Inflammation and Lipids. ClinicalTrials.gov.
  url: https://clinicaltrials.gov/study/NCT02670382
researchEvidence:
  designKind: crossover_trial
  designLabel: Crossover
  participantCount: 24
  participantCountKind: reported
  populationLabel: Men and women with metabolic syndrome features, elevated hsCRP, and triglycerides within the registry eligibility range.
  durationLabel: 4-week placebo lead-in; 10-week active periods; 10-week washout in linked protocol information.
  aggregateRole: context
  cohortKey: cohort:clinicaltrials-nct02670382-2026-04-25
evidenceBucket: inflammation_immune_markers
whyItMatters: Connects the ComparED-like mechanistic reports to registered design and safety/dropout context.
potentialMurphEndpoints:
- trial design
- EPA 3 g/day
- DHA 3 g/day
- dropouts
protocolTakeaway: Useful for linking mechanistic publications and confirming protocol details.
murphTakeaway: Registry confirms high-dose EPA/DHA crossover design for inflammation and lipid endpoints.
studyDesign: crossover
modality: omega-3 supplementation context
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---
This source is included for **inflammation_immune_markers**.

**Findings:** Registry source defines the trial design and outcomes; linked publications report serum inflammatory-marker null findings with monocyte-response effects, but the registry itself is not an efficacy result. [source_artifact:clinicaltrials-nct02670382-2026-04-25]

**Why it matters:** Connects the ComparED-like mechanistic reports to registered design and safety/dropout context.

**Potential experiment signals:** trial design, EPA 3 g/day, DHA 3 g/day, dropouts.

**Protocol takeaway:** Useful for linking mechanistic publications and confirming protocol details.

**Population mismatch:** Same-mechanism registry context for EPA/DHA component trials.

**Safety notes:** Linked registry/protocol extraction noted three dropouts, including family reasons, gout during placebo lead-in, and leg cramps during placebo lead-in; active-phase causality was not established in extracted material.

**Limitations:** Trial registry is protocol/design evidence, not a peer-reviewed efficacy result. Small metabolic-syndrome sample and high-dose component periods.

**Claim use:** `context-only`.
