---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:rand-omega3-major-depressive-disorder-2015-10-06
slug: sources/omega-3-supplementation/rand-omega3-major-depressive-disorder-2015-10-06
title: Omega-3 Fatty Acids for Major Depressive Disorder
summary: RAND systematic review in major depressive disorder, included here only for adjacent clinical and adverse-event framing, not exercise recovery.
status: draft
quality: usable
aliases:
- rand-omega3-major-depressive-disorder-2015-10-06
categories:
- omega-3-supplementation
relations:
-
  type: related_protocol
  target: protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation
-
  type: parent_family
  target: experiment_family:omega-3-supplementation
sourceKind: review
directnessToProtocol: adjacent_variant
source:
  kind: review
  title: Omega-3 Fatty Acids for Major Depressive Disorder
  authors: Newberry S, et al.
  year: 2015
  journal: RAND Corporation Research Report
  citation: Newberry S, et al. Omega-3 Fatty Acids for Major Depressive Disorder. RAND Corporation Research Report RR-1079. 2015.
  url: https://www.rand.org/pubs/research_reports/RR1079.html
researchEvidence:
  designKind: systematic_review
  designLabel: Systematic review for major depressive disorder
  populationLabel: Adults with major depressive disorder in psychiatric-treatment studies
  durationLabel: Varied across included depression trials
  aggregateRole: synthesis
  cohortKey: rand-2015-omega-3-major-depressive-disorder-review
  notes:
  - 'Participant count not extracted for this batch; count kind from notes: not_applicable_review.'
evidenceBucket: exercise_recovery_soreness
whyItMatters: It gives high-quality safety and adjacent clinical context without supporting exercise-recovery claims.
potentialMurphEndpoints:
- mood diary only if separately scoped
- GI adverse-event diary
- clinical-care exclusion flag
protocolTakeaway: Adjacent-variant systematic review; not a source for recovery, soreness, or healthy-adult performance claims.
murphTakeaway: Do not use a wellness protocol to self-treat depression without medical care.
studyDesign: Systematic review for major depressive disorder
modality: Omega-3 fatty acids in major depressive disorder treatment studies
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: permission_required
---
This source is included for **exercise_recovery_soreness**.

**Findings:** The RAND review evaluated omega-3 fatty acids for major depressive disorder. It reported weak evidence that EPA-containing regimens may have small symptom benefits versus placebo and noted generally minor gastrointestinal adverse events. This is not exercise-recovery evidence.

**Why it matters:** It gives high-quality safety and adjacent clinical context without supporting exercise-recovery claims.

**Potential experiment signals:** mood diary only if separately scoped, GI adverse-event diary, clinical-care exclusion flag.

**Protocol takeaway:** Adjacent-variant systematic review; not a source for recovery, soreness, or healthy-adult performance claims.

**Claim use:** `context-only`.
