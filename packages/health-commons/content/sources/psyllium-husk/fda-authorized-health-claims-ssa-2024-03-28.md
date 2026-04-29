---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:fda-authorized-health-claims-ssa-2024-03-28"
slug: "sources/psyllium-husk/fda-authorized-health-claims-ssa-2024-03-28"
title: "Authorized Health Claims That Meet Significant Scientific Agreement (SSA) Standard"
summary: "FDA overview page explaining the significant scientific agreement standard and listing authorized health claims, including soluble fiber from certain foods and CHD."
status: "draft"
quality: "usable"
aliases:
  - "fda-authorized-health-claims-ssa-2024-03-28"
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
  title: "Authorized Health Claims That Meet Significant Scientific Agreement (SSA) Standard"
  authors: "U.S. Food and Drug Administration"
  year: 2024
  journal: "FDA"
  citation: "U.S. Food and Drug Administration. Authorized Health Claims That Meet Significant Scientific Agreement (SSA) Standard. FDA. 2024. URL: https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/authorized-health-claims-meet-significant-scientific-agreement-ssa-standard."
  url: "https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/authorized-health-claims-meet-significant-scientific-agreement-ssa-standard"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "e57ae0e406c92b09d24229cccd4a72d2a0e99a5f858c8a1122e362416c9239d9"
    url: "https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/authorized-health-claims-meet-significant-scientific-agreement-ssa-standard"
  canonicalUrl: "https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/authorized-health-claims-meet-significant-scientific-agreement-ssa-standard"
researchEvidence:
  designKind: "guideline"
  designLabel: "guideline"
  populationLabel: "U.S. food-labeling claim context."
  durationLabel: "Regulatory framework; no intervention duration."
  aggregateRole: "context"
  cohortKey: "fda-authorized-health-claims-ssa-2024-03-28"
  notes:
    - "Participant count is not applicable or not reported for this regulatory/guideline/context source."
evidenceBucket: "Regulatory, guideline, and external health-claim context"
whyItMatters: "Clarifies that authorized FDA claims meet a regulatory standard but still are not trial-level protocol evidence."
potentialMurphEndpoints:
  - "claim category"
  - "regulatory basis"
  - "CHD claim"
protocolTakeaway: "Use to explain FDA claim hierarchy and avoid treating claim authorization as direct efficacy evidence."
murphTakeaway: "The SSA page helps classify external claims and their limits."
studyDesign: "guideline"
modality: "psyllium husk / soluble fiber cholesterol context"
claimUse: "context-only"
sourceFindings:

  -
    findingId: "finding:fda-authorized-health-claims-ssa-2024-03-28-ssa-authorized-claim-framework"
    sourceKey: "source_artifact:fda-authorized-health-claims-ssa-2024-03-28"
    findingKind: "context"
    population: "U.S. consumers and food manufacturers."
    exposure: "FDA-authorized health claims meeting significant scientific agreement."
    outcome: "Regulatory claim standard."
    summary: "FDA describes authorized health claims as claims meeting the significant scientific agreement standard and lists the soluble-fiber/CHD claim, making this a regulatory context source rather than a psyllium trial."
    evidenceUse:
      - "context"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
extractionNotes:
  batchId: "batch-006"
  evidenceBucket: "Regulatory, guideline, and external health-claim context"
  participantCountNote: "No source-level participant count was applicable or extractable for this context batch unless an included-study count is explicitly listed."
  claimUseBoundary: "context-only; do not use as primary efficacy evidence for the protocol."
populationMismatch: "Labeling/legal context rather than clinical protocol."
limitations: "Framework page; not a scientific review of psyllium trials."
safetyNotes: "No adverse-event extraction."
---
This source is included for **Regulatory, guideline, and external health-claim context**.

**Findings:** The page describes the evidentiary standard for authorized claims and lists soluble fiber from certain foods and CHD under 21 CFR 101.81; no psyllium-specific effect estimate.

**Why it matters:** Clarifies that authorized FDA claims meet a regulatory standard but still are not trial-level protocol evidence.

**Potential experiment signals:** claim category, regulatory basis, CHD claim

**Protocol takeaway:** Use to explain FDA claim hierarchy and avoid treating claim authorization as direct efficacy evidence.

**Claim use:** `context-only`.

## Extracted source fields

- **Participant count:** Not applicable or not reported for this context source.
- **Participant count kind:** Not applicable/not extracted.
- **Population:** U.S. food-labeling claim context.
- **Intervention / exposure:** FDA-authorized health claims under the SSA standard.
- **Comparator / control:** Qualified claims or non-authorized claim categories.
- **Duration / follow-up:** Regulatory framework; no intervention duration.
- **Endpoints:** claim standard, CHD claim, diet context
- **Adverse events / safety notes:** No adverse-event extraction.
- **Limitations:** Framework page; not a scientific review of psyllium trials.
- **Population mismatch:** Labeling/legal context rather than clinical protocol.
- **Directness to Psyllium Husk For Cholesterol:** general_guideline
- **Artifact / rights notes:** No downloadable artifact candidate required for this batch; rights status open_access.

## Source-owned findings

- `finding:fda-authorized-health-claims-ssa-2024-03-28-ssa-authorized-claim-framework` — FDA describes authorized health claims as claims meeting the significant scientific agreement standard and lists the soluble-fiber/CHD claim, making this a regulatory context source rather than a psyllium trial.
