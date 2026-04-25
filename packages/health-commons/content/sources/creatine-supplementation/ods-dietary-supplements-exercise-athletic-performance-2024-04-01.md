---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:ods-dietary-supplements-exercise-athletic-performance-2024-04-01
slug: sources/creatine-supplementation/ods-dietary-supplements-exercise-athletic-performance-2024-04-01
title: Dietary Supplements for Exercise and Athletic Performance
summary: ODS summarizes creatine as a widely studied ergogenic supplement for short, high-intensity efforts, with weight gain as the most consistent side effect and limited value for endurance performance.
status: draft
quality: usable
aliases:
  - Dietary Supplements for Exercise and Athletic Performance
categories:
  - creatine-supplementation
relations:
  -
    type: related_protocol
    target: protocol_variant:creatine-supplementation/creatine-monohydrate
  -
    type: parent_family
    target: experiment_family:creatine-supplementation
source:
  kind: web_page
  title: Dietary Supplements for Exercise and Athletic Performance
  authors: NIH Office of Dietary Supplements
  year: 2024
  journal: NIH Office of Dietary Supplements Fact Sheet
  citation: 'NIH Office of Dietary Supplements. Dietary Supplements for Exercise and Athletic Performance: Fact Sheet for Health Professionals. Updated April 1, 2024.'

  url: https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/
researchEvidence:
  designKind: guideline
  designLabel: Government health-professional evidence summary

  populationLabel: Healthy athletes, active adults, and supplement users addressed in a health-professional fact sheet.
  durationLabel: Typical loading 5-7 days; maintenance or gradual dosing over weeks.
  aggregateRole: primary
  cohortKey: cohort:ods-dietary-supplements-exercise-athletic-performance-2024-04-01
evidenceBucket: background_guidelines_external
whyItMatters: ODS summarizes creatine as a widely studied ergogenic supplement for short, high-intensity efforts, with weight gain as the most consistent side effect and limited value for endurance performance.
potentialMurphEndpoints:
  - body weight
  - repeated-sprint/power performance
  - GI symptoms
  - hydration notes
protocolTakeaway: Creatine monohydrate dosing can be framed around loading plus maintenance or slower daily dosing, with expected weight gain and GI watchouts.
murphTakeaway: Creatine monohydrate dosing can be framed around loading plus maintenance or slower daily dosing, with expected weight gain and GI watchouts.
studyDesign: guideline
modality: Creatine supplementation
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **background_guidelines_external**.

**Findings:**
- **dose / Dose and saturation strategy:** ODS describes common loading and maintenance approaches used to raise muscle creatine stores. Directness: `background`. Claim use: `context-only`.
- **outcome / Repeated short high-intensity activity:** ODS summarizes the performance benefit as most relevant to repeated short, high-intensity efforts rather than endurance performance. Directness: `background`. Claim use: `context-only`.
- **safety / Weight gain, water retention, GI symptoms, cramps/heat intolerance anecdotes:** ODS identifies weight gain from water retention and/or protein synthesis as the most consistent side effect and flags GI/hydration watchouts. Directness: `background`. Claim use: `context-only`.
- **limitation / Formulation superiority:** The formulation boundary supports keeping this protocol focused on monohydrate. Directness: `background`. Claim use: `context-only`.

**Why it matters:** ODS summarizes creatine as a widely studied ergogenic supplement for short, high-intensity efforts, with weight gain as the most consistent side effect and limited value for endurance performance.

**Potential experiment signals:**
- body weight
- repeated-sprint/power performance
- GI symptoms
- hydration notes

**Protocol takeaway:** Creatine monohydrate dosing can be framed around loading plus maintenance or slower daily dosing, with expected weight gain and GI watchouts.

**Limitations and boundary notes:**
- Government summary, not a direct trial
- Individual response and body size vary
- Aggregated fact-sheet statement without one pooled estimate
- Underlying studies are heterogeneous
- Fact sheet does not provide one pooled adverse-event rate
- Anecdotal events should not be treated as established causal effects
- Background source, not head-to-head synthesis

**Extraction notes:**
- None beyond the source-specific caveats above.

**Claim use:** `context-only`.
