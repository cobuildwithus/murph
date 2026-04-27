---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:fda-dietary-fiber-qa-2024-07-25"
slug: "sources/psyllium-husk/fda-dietary-fiber-qa-2024-07-25"
title: "Questions and Answers on Dietary Fiber"
summary: "FDA dietary-fiber Q&A explaining dietary-fiber labeling, recognized beneficial physiological effects, and psyllium husk inclusion."
status: "draft"
quality: "usable"
aliases:
  - "fda-dietary-fiber-qa-2024-07-25"
categories:
  - "psyllium-husk"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:psyllium-husk"
source:
  kind: "web_page"
  title: "Questions and Answers on Dietary Fiber"
  authors: "U.S. Food and Drug Administration"
  year: 2024
  journal: "FDA"
  citation: "U.S. Food and Drug Administration. Questions and Answers on Dietary Fiber. FDA. 2024. URL: https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/questions-and-answers-dietary-fiber."
  url: "https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/questions-and-answers-dietary-fiber"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "0b484b074f11543900458963b573ad6374ea547baa903e450d50831dc2dd2fe0"
    url: "https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/questions-and-answers-dietary-fiber"
  canonicalUrl: "https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/questions-and-answers-dietary-fiber"
researchEvidence:
  designKind: "guideline"
  designLabel: "guideline"
  populationLabel: "U.S. Nutrition Facts and Supplement Facts labeling context."
  durationLabel: "Regulatory Q&A; no intervention duration."
  aggregateRole: "context"
  cohortKey: "fda-dietary-fiber-qa-2024-07-25"
  notes:
    - "Participant count is not applicable or not reported for this regulatory/guideline/context source."
evidenceBucket: "Regulatory, guideline, and external health-claim context"
whyItMatters: "Supports the boundary that psyllium is a recognized dietary fiber in FDA labeling context."
potentialMurphEndpoints:
  - "dietary fiber grams"
  - "LDL-C"
  - "total cholesterol"
protocolTakeaway: "Use for regulatory dietary-fiber framing only."
murphTakeaway: "Dietary-fiber status and cholesterol endpoints are relevant context but do not estimate a personal response."
studyDesign: "guideline"
modality: "psyllium husk / soluble fiber cholesterol context"
claimUse: "context-only"
sourceFindings:
  -
    findingId: "finding:fda-dietary-fiber-qa-2024-07-25-dietary-fiber-qa-psyllium-status"
    sourceKey: "source_artifact:fda-dietary-fiber-qa-2024-07-25"
    findingKind: "context"
    population: "U.S. dietary-fiber labeling context."
    exposure: "Psyllium husk as a recognized dietary fiber."
    outcome: "Beneficial physiological effects including blood-cholesterol lowering."
    summary: "FDA's dietary-fiber Q&A lists lowering blood cholesterol and LDL-C among recognized beneficial effects and includes psyllium husk in dietary-fiber labeling context."
    evidenceUse:
      - "context"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
extractionNotes:
  batchId: "batch-006"
  evidenceBucket: "Regulatory, guideline, and external health-claim context"
  participantCountNote: "No source-level participant count was applicable or extractable for this context batch unless an included-study count is explicitly listed."
  claimUseBoundary: "context-only; do not use as primary efficacy evidence for the protocol."
populationMismatch: "Regulatory labeling context, not intervention study participants."
limitations: "Labeling Q&A, not primary efficacy data."
safetyNotes: "No adverse-event extraction from the Q&A."
---
This source is included for **Regulatory, guideline, and external health-claim context**.

**Findings:** FDA identifies blood-cholesterol and LDL-C lowering among beneficial physiological effects relevant to dietary fiber and includes psyllium husk under the dietary-fiber definition; no protocol effect size.

**Why it matters:** Supports the boundary that psyllium is a recognized dietary fiber in FDA labeling context.

**Potential experiment signals:** dietary fiber grams, LDL-C, total cholesterol

**Protocol takeaway:** Use for regulatory dietary-fiber framing only.

**Claim use:** `context-only`.

## Extracted source fields

- **Participant count:** Not applicable or not reported for this context source.
- **Participant count kind:** Not applicable/not extracted.
- **Population:** U.S. Nutrition Facts and Supplement Facts labeling context.
- **Intervention / exposure:** Intrinsic/intact fibers and isolated or synthetic non-digestible carbohydrates recognized as dietary fiber, including psyllium husk.
- **Comparator / control:** Non-digestible carbohydrates without recognized beneficial physiological effect.
- **Duration / follow-up:** Regulatory Q&A; no intervention duration.
- **Endpoints:** dietary fiber definition, blood cholesterol, LDL-C, labeling
- **Adverse events / safety notes:** No adverse-event extraction from the Q&A.
- **Limitations:** Labeling Q&A, not primary efficacy data.
- **Population mismatch:** Regulatory labeling context, not intervention study participants.
- **Directness to Psyllium Husk For Cholesterol:** same_mechanism
- **Artifact / rights notes:** No downloadable artifact candidate required for this batch; rights status open_access.

## Source-owned findings

- `finding:fda-dietary-fiber-qa-2024-07-25-dietary-fiber-qa-psyllium-status` — FDA's dietary-fiber Q&A lists lowering blood cholesterol and LDL-C among recognized beneficial effects and includes psyllium husk in dietary-fiber labeling context.
