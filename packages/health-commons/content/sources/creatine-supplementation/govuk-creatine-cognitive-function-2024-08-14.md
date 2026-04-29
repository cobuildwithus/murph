---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:govuk-creatine-cognitive-function-2024-08-14
slug: sources/creatine-supplementation/govuk-creatine-cognitive-function-2024-08-14
title: 'UKNHCC scientific opinion: creatine supplementation and improved cognitive function'
summary: The UKNHCC concluded that evidence did not establish a cause-and-effect relationship between up to 3 g/day creatine and improved cognitive function in healthy adults.
status: draft
quality: usable
aliases:
  - 'UKNHCC scientific opinion: creatine supplementation and improved cognitive function'
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
  kind: guideline
  title: 'UKNHCC scientific opinion: creatine supplementation and improved cognitive function'
  authors: UK Nutrition and Health Claims Committee
  year: 2024
  journal: GOV.UK scientific opinion
  citation: 'UK Nutrition and Health Claims Committee. UKNHCC scientific opinion: creatine supplementation and improved cognitive function. GOV.UK. Published 14 August 2024.'

  url: https://www.gov.uk/government/publications/uknhcc-scientific-opinion-creatine-supplementation-and-improved-cognitive-function
researchEvidence:
  designKind: guideline
  designLabel: Guideline

  populationLabel: Healthy adults aged 18 years or older under the proposed health-claim conditions; submitted RCTs also included mismatched doses/populations.
  durationLabel: Mixed; proposed daily intake was 3 g/day.
  aggregateRole: context
  cohortKey: cohort:govuk-creatine-cognitive-function-2024-08-14
evidenceBucket: background_guidelines_external
whyItMatters: The UKNHCC concluded that evidence did not establish a cause-and-effect relationship between up to 3 g/day creatine and improved cognitive function in healthy adults.
potentialMurphEndpoints:
  - self-rated cognition
  - reaction time
  - working memory
  - GI symptoms
protocolTakeaway: Do not claim daily 3 g creatine improves cognition based on this source.
murphTakeaway: Do not claim daily 3 g creatine improves cognition based on this source.
studyDesign: guideline
modality: Creatine supplementation
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **background_guidelines_external**.

**Findings:**
- **null_result / Cognitive function:** UKNHCC rejected the proposed cognitive-function claim for creatine at the claimed intake. Directness: `background`. Claim use: `context-only`.
- **limitation / Claim pertinence and generalizability:** Dose and population mismatches were central to rejecting the claim. Directness: `background`. Claim use: `context-only`.
- **adverse_event / GI distress:** The source supports splitting larger daily doses rather than taking high bolus doses. Directness: `background`. Claim use: `context-only`.

**Why it matters:** The UKNHCC concluded that evidence did not establish a cause-and-effect relationship between up to 3 g/day creatine and improved cognitive function in healthy adults.

**Potential experiment signals:**
- self-rated cognition
- reaction time
- working memory
- GI symptoms

**Protocol takeaway:** Do not claim daily 3 g creatine improves cognition based on this source.

**Limitations and boundary notes:**
- Regulatory opinion
- Only one submitted RCT was considered pertinent to the exact proposed conditions
- Submitted evidence may not cover all possible cognitive contexts
- Not direct exercise-performance evidence
- Dossier-level safety note; exact adverse-event rate not extracted

**Extraction notes:**
- None beyond the source-specific caveats above.

**Claim use:** `context-only`.
