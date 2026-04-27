---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:health-canada-psyllium-cholesterol-2011-12-16"
slug: "sources/psyllium-husk/health-canada-psyllium-cholesterol-2011-12-16"
title: "Summary of Health Canada's Assessment of a Health Claim about Food Products Containing Psyllium and Blood Cholesterol Lowering"
summary: "Health Canada assessment supporting a cholesterol-lowering claim for foods containing psyllium; useful cross-jurisdiction regulatory context."
status: "draft"
quality: "usable"
aliases:
  - "health-canada-psyllium-cholesterol-2011-12-16"
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
  title: "Summary of Health Canada's Assessment of a Health Claim about Food Products Containing Psyllium and Blood Cholesterol Lowering"
  authors: "Health Canada"
  year: 2011
  journal: "Health Canada"
  citation: "Health Canada. Summary of Health Canada's Assessment of a Health Claim about Food Products Containing Psyllium and Blood Cholesterol Lowering. Health Canada. 2011. URL: https://www.canada.ca/en/health-canada/services/food-nutrition/food-labelling/health-claims/assessments/psyllium-products-blood-cholesterol-lowering-nutrition-health-claims-food-labelling.html."
  url: "https://www.canada.ca/en/health-canada/services/food-nutrition/food-labelling/health-claims/assessments/psyllium-products-blood-cholesterol-lowering-nutrition-health-claims-food-labelling.html"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "6dbfb74729da6e772e9c29fb7f597d6885605e67a4c00dbda596cdabe86028fd"
    url: "https://www.canada.ca/en/health-canada/services/food-nutrition/food-labelling/health-claims/assessments/psyllium-products-blood-cholesterol-lowering-nutrition-health-claims-food-labelling.html"
  canonicalUrl: "https://www.canada.ca/en/health-canada/services/food-nutrition/food-labelling/health-claims/assessments/psyllium-products-blood-cholesterol-lowering-nutrition-health-claims-food-labelling.html"
researchEvidence:
  designKind: "guideline"
  designLabel: "guideline"
  populationLabel: "General population wanting to maintain or lower blood cholesterol."
  durationLabel: "Regulatory assessment of human studies; no single follow-up duration extracted."
  aggregateRole: "context"
  cohortKey: "health-canada-psyllium-cholesterol-2011-12-16"
  notes:
    - "Participant count is not applicable or not reported for this regulatory/guideline/context source."
  includedStudyCount: 21
  aggregationNote: "Health Canada reports that its assessment considered 21 human studies via the cited systematic review/assessment context; participant count was not extracted here."
evidenceBucket: "Regulatory, guideline, and external health-claim context"
whyItMatters: "Provides a non-U.S. regulatory dose and claim boundary specific to psyllium and cholesterol lowering."
potentialMurphEndpoints:
  - "daily psyllium fibre grams"
  - "per-serving psyllium fibre"
  - "LDL-C"
  - "total cholesterol"
protocolTakeaway: "Use for external health-claim boundary context; cite direct trials/meta-analyses for protocol efficacy."
murphTakeaway: "Health Canada's review supports a 7 g/day claim threshold but remains a regulatory claim source."
studyDesign: "guideline"
modality: "psyllium husk / soluble fiber cholesterol context"
claimUse: "context-only"
sourceFindings:
  -
    findingId: "finding:health-canada-psyllium-cholesterol-2011-12-16-health-canada-7g-claim-context"
    sourceKey: "source_artifact:health-canada-psyllium-cholesterol-2011-12-16"
    findingKind: "context"
    population: "General population wanting to maintain or lower blood cholesterol."
    exposure: "Psyllium fibre in foods at a daily amount of 7 g."
    outcome: "LDL-C and total cholesterol claim substantiation."
    summary: "Health Canada's assessment concluded that evidence supported a blood-cholesterol-lowering claim for psyllium-containing foods, identified 7 g/day psyllium fibre as the lowest observed efficacious daily intake, and reported LDL-C lowering across reviewed studies as 0.047% to 0.86% per gram fibre."
    evidenceUse:
      - "context"
  -
    findingId: "finding:health-canada-psyllium-cholesterol-2011-12-16-health-canada-serving-criteria"
    sourceKey: "source_artifact:health-canada-psyllium-cholesterol-2011-12-16"
    findingKind: "context"
    population: "Food products seeking Canadian claim eligibility."
    exposure: "Psyllium-containing food servings."
    outcome: "Per-serving claim eligibility."
    summary: "Health Canada set serving conditions for the claim, including at least 1.75 g psyllium fibre per reference amount and per serving, while monitoring whether the daily amount can be feasibly consumed over four eating occasions."
    evidenceUse:
      - "context"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
extractionNotes:
  batchId: "batch-006"
  evidenceBucket: "Regulatory, guideline, and external health-claim context"
  participantCountNote: "No source-level participant count was applicable or extractable for this context batch unless an included-study count is explicitly listed."
  claimUseBoundary: "context-only; do not use as primary efficacy evidence for the protocol."
populationMismatch: "External regulatory claim context; not an N-of-1 adult protocol test."
limitations: "Regulatory assessment and label claim, not a primary trial; underlying study-level heterogeneity and total participant counts are not extracted here."
safetyNotes: "No specific adverse-event rate extracted from the web assessment in this batch."
---
This source is included for **Regulatory, guideline, and external health-claim context**.

**Findings:** Health Canada reported a physiologically meaningful LDL-C reduction range of 0.047% to 0.86% per gram psyllium fibre across its evidence review and identified 7 g/day as the lowest observed efficacious daily intake for claim purposes.

**Why it matters:** Provides a non-U.S. regulatory dose and claim boundary specific to psyllium and cholesterol lowering.

**Potential experiment signals:** daily psyllium fibre grams, per-serving psyllium fibre, LDL-C, total cholesterol

**Protocol takeaway:** Use for external health-claim boundary context; cite direct trials/meta-analyses for protocol efficacy.

**Claim use:** `context-only`.

## Extracted source fields

- **Participant count:** Not applicable or not reported for this context source.
- **Participant count kind:** Not applicable/not extracted.
- **Population:** General population wanting to maintain or lower blood cholesterol.
- **Intervention / exposure:** Food products providing 7 g/day psyllium fibre, with per-serving claim criteria.
- **Comparator / control:** Foods not providing qualifying psyllium amount or placebo/comparator arms in underlying studies.
- **Duration / follow-up:** Regulatory assessment of human studies; no single follow-up duration extracted.
- **Endpoints:** LDL-C, total cholesterol, blood cholesterol claim, serving criteria
- **Adverse events / safety notes:** No specific adverse-event rate extracted from the web assessment in this batch.
- **Limitations:** Regulatory assessment and label claim, not a primary trial; underlying study-level heterogeneity and total participant counts are not extracted here.
- **Population mismatch:** External regulatory claim context; not an N-of-1 adult protocol test.
- **Directness to Psyllium Husk For Cholesterol:** general_guideline
- **Artifact / rights notes:** No downloadable artifact candidate required for this batch; rights status open_access.

## Source-owned findings

- `finding:health-canada-psyllium-cholesterol-2011-12-16-health-canada-7g-claim-context` — Health Canada's assessment concluded that evidence supported a blood-cholesterol-lowering claim for psyllium-containing foods, identified 7 g/day psyllium fibre as the lowest observed efficacious daily intake, and reported LDL-C lowering across reviewed studies as 0.047% to 0.86% per gram fibre.
- `finding:health-canada-psyllium-cholesterol-2011-12-16-health-canada-serving-criteria` — Health Canada set serving conditions for the claim, including at least 1.75 g psyllium fibre per reference amount and per serving, while monitoring whether the daily amount can be feasibly consumed over four eating occasions.
