---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct03295708-2026-04-25
slug: sources/omega-3-supplementation/clinicaltrials-nct03295708-2026-04-25
title: Fish Oil as Adjunct Treatment for Major Depressive Disorder
summary: Registry-only MDD adjunctive fish-oil trial record with planned EPA+DHA dosing.
status: draft
quality: usable
aliases:
- Fish Oil as Adjunct Treatment for Major Depressive Disorder
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
  title: Fish Oil as Adjunct Treatment for Major Depressive Disorder
  authors: ClinicalTrials.gov registry record; Second Xiangya Hospital of Central South University
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Fish Oil as Adjunct Treatment for Major Depressive Disorder. NCT03295708. Accessed 2026-04-25.
  url: https://clinicaltrials.gov/study/NCT03295708
researchEvidence:
  designKind: other
  designLabel: Trial registry / protocol record
  participantCount: 120
  participantCountKind: approximate
  populationLabel: Patients with major depressive disorder.
  durationLabel: 24 weeks treatment within a 12-month randomized placebo-controlled clinical-trial protocol.
  aggregateRole: context
  cohortKey: clinicaltrials-nct03295708-2026-04-25
evidenceBucket: mood_cognition
whyItMatters: Trial registry context for MDD adjunctive evidence.
potentialMurphEndpoints:
- HAM-D24
- HAMA
- BDI
- SAS
- CGI-S
- CGI-I
- SERS
- RBANS
- STROOP
- BMD
- MRI
protocolTakeaway: Use only for protocol/trial-design metadata until results are extracted.
murphTakeaway: Use only for protocol/trial-design metadata until results are extracted.
studyDesign: other
modality: oral EPA/DHA supplementation
claimUse: context-only
murphV1Priority: Low
pdfRightsStatus: unknown
---
This source is included for **mood_cognition**.

**Findings:** Trial registry/protocol context only; no efficacy results extracted from the registry record in this batch. Safety note: Safety/effectiveness/mechanism protocol with SERS endpoint; no observed adverse events extracted.

**Why it matters:** Trial registry context for MDD adjunctive evidence.

**Potential experiment signals:** HAM-D24, HAMA, BDI, SAS, CGI-S, CGI-I, SERS, RBANS, STROOP, BMD, MRI.

**Protocol takeaway:** Use only for protocol/trial-design metadata until results are extracted.

**Population mismatch:** Clinical MDD adjunct treatment, not general mood wellness.

**Limitations:** Registry record is not efficacy evidence unless results/publication are linked and extracted.; MDD adjunct treatment is clinician-supervised.

**Claim use:** `context-only`.
