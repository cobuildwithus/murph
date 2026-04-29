---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:foodstandards-pectins-blood-cholesterol-2015-10-30"
slug: "sources/psyllium-husk/foodstandards-pectins-blood-cholesterol-2015-10-30"
title: "Systematic Review of the Evidence for a Relationship between Pectins and Blood Cholesterol Concentrations"
summary: "FSANZ systematic-review page for pectins and blood cholesterol; adjacent soluble-fiber regulatory context, not psyllium evidence."
status: "draft"
quality: "usable"
aliases:
  - "foodstandards-pectins-blood-cholesterol-2015-10-30"
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
  kind: "review"
  title: "Systematic Review of the Evidence for a Relationship between Pectins and Blood Cholesterol Concentrations"
  authors: "Food Standards Australia New Zealand"
  year: 2015
  journal: "Food Standards Australia New Zealand"
  citation: "Food Standards Australia New Zealand. Systematic Review of the Evidence for a Relationship between Pectins and Blood Cholesterol Concentrations. Food Standards Australia New Zealand. 2015. URL: https://www.foodstandards.gov.au/publications/Systematic-Review-of-the-Evidence-for-a-Relationship-between-Pectins-and-Blood-Cholesterol-Concentrations."
  url: "https://www.foodstandards.gov.au/publications/Systematic-Review-of-the-Evidence-for-a-Relationship-between-Pectins-and-Blood-Cholesterol-Concentrations"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "05b45077a16eab8404cc7e4352f4e6abff3f2b1d0b83a5bee5cb07795d976ec2"
    url: "https://www.foodstandards.gov.au/publications/Systematic-Review-of-the-Evidence-for-a-Relationship-between-Pectins-and-Blood-Cholesterol-Concentrations"
  canonicalUrl: "https://www.foodstandards.gov.au/publications/Systematic-Review-of-the-Evidence-for-a-Relationship-between-Pectins-and-Blood-Cholesterol-Concentrations"
researchEvidence:
  designKind: "systematic_review"
  designLabel: "systematic_review"
  populationLabel: "Human studies and food-health relationship assessment context for pectins."
  durationLabel: "Systematic review; no single intervention duration extracted from page metadata."
  aggregateRole: "context"
  cohortKey: "foodstandards-pectins-blood-cholesterol-2015-10-30"
  notes:
    - "Participant count is not applicable or not reported for this regulatory/guideline/context source."
evidenceBucket: "Regulatory, guideline, and external health-claim context"
whyItMatters: "Preserves high-quality grey-literature context for soluble-fiber health claims without substituting pectin evidence for psyllium."
potentialMurphEndpoints:
  - "fiber type"
  - "LDL-C"
  - "total cholesterol"
protocolTakeaway: "Use only for adjacent soluble-fiber regulatory context."
murphTakeaway: "Pectin evidence belongs in adjacent-variant context, not in direct psyllium claims."
studyDesign: "systematic_review"
modality: "adjacent soluble fiber cholesterol context"
claimUse: "context-only"
sourceFindings:

  -
    findingId: "finding:foodstandards-pectins-blood-cholesterol-2015-10-30-pectin-adjacent-review-context"
    sourceKey: "source_artifact:foodstandards-pectins-blood-cholesterol-2015-10-30"
    findingKind: "context"
    population: "Human intervention-study evidence considered in a food-health relationship review."
    exposure: "Pectins."
    outcome: "Blood cholesterol concentrations."
    summary: "FSANZ's page describes a systematic review of pectins and blood cholesterol as part of food-health relationship work; it is adjacent soluble-fiber context and no psyllium-specific effect estimate was extracted."
    evidenceUse:
      - "adjacent_variant"
      - "context"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
extractionNotes:
  batchId: "batch-006"
  evidenceBucket: "Regulatory, guideline, and external health-claim context"
  participantCountNote: "No source-level participant count was applicable or extractable for this context batch unless an included-study count is explicitly listed."
  claimUseBoundary: "context-only; do not use as primary efficacy evidence for the protocol."
populationMismatch: "Adjacent soluble-fiber ingredient and regulatory review."
limitations: "Pectins, not psyllium; public page did not expose detailed effect estimates in extracted text."
safetyNotes: "No psyllium-specific safety information."
---
This source is included for **Regulatory, guideline, and external health-claim context**.

**Findings:** The public page identifies the systematic review topic and regulatory context; no pectin effect size was extracted in this batch.

**Why it matters:** Preserves high-quality grey-literature context for soluble-fiber health claims without substituting pectin evidence for psyllium.

**Potential experiment signals:** fiber type, LDL-C, total cholesterol

**Protocol takeaway:** Use only for adjacent soluble-fiber regulatory context.

**Claim use:** `context-only`.

## Extracted source fields

- **Participant count:** Not applicable or not reported for this context source.
- **Participant count kind:** Not applicable/not extracted.
- **Population:** Human studies and food-health relationship assessment context for pectins.
- **Intervention / exposure:** Pectin consumption.
- **Comparator / control:** Control foods or placebo arms in pectin studies considered by the review.
- **Duration / follow-up:** Systematic review; no single intervention duration extracted from page metadata.
- **Endpoints:** blood cholesterol, LDL-C, total cholesterol, regulatory relationship
- **Adverse events / safety notes:** No psyllium-specific safety information.
- **Limitations:** Pectins, not psyllium; public page did not expose detailed effect estimates in extracted text.
- **Population mismatch:** Adjacent soluble-fiber ingredient and regulatory review.
- **Directness to Psyllium Husk For Cholesterol:** adjacent_variant
- **Artifact / rights notes:** No downloadable artifact candidate required for this batch; rights status open_access.

## Source-owned findings

- `finding:foodstandards-pectins-blood-cholesterol-2015-10-30-pectin-adjacent-review-context` — FSANZ's page describes a systematic review of pectins and blood cholesterol as part of food-health relationship work; it is adjacent soluble-fiber context and no psyllium-specific effect estimate was extracted.
