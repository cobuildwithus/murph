---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:fda-non-digestible-carbohydrates-review-2018-06-14"
slug: "sources/psyllium-husk/fda-non-digestible-carbohydrates-review-2018-06-14"
title: "Review of the Scientific Evidence on the Physiological Effects of Certain Non-Digestible Carbohydrates"
summary: "FDA scientific review of non-digestible carbohydrates that identifies psyllium husk as dietary fiber within the existing CHD health-claim framework."
status: "draft"
quality: "usable"
aliases:
  - "fda-non-digestible-carbohydrates-review-2018-06-14"
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
  kind: "other"
  title: "Review of the Scientific Evidence on the Physiological Effects of Certain Non-Digestible Carbohydrates"
  authors: "U.S. Food and Drug Administration"
  year: 2018
  journal: "FDA"
  citation: "U.S. Food and Drug Administration. Review of the Scientific Evidence on the Physiological Effects of Certain Non-Digestible Carbohydrates. FDA. 2018. URL: https://www.fda.gov/files/food/published/Review-of-the-Scientific-Evidence-on-the-Physiological-Effects-of-Certain-Non-Digestible-Carbohydrates-PDF.pdf."
  url: "https://www.fda.gov/files/food/published/Review-of-the-Scientific-Evidence-on-the-Physiological-Effects-of-Certain-Non-Digestible-Carbohydrates-PDF.pdf"
sourceIdentity:
  identityKind: "other"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "ab027ca9a84495e015dee5907c17451b9eb837ceeb7f6198373bc055272be4e0"
    url: "https://www.fda.gov/files/food/published/Review-of-the-Scientific-Evidence-on-the-Physiological-Effects-of-Certain-Non-Digestible-Carbohydrates-PDF.pdf"
  canonicalUrl: "https://www.fda.gov/files/food/published/Review-of-the-Scientific-Evidence-on-the-Physiological-Effects-of-Certain-Non-Digestible-Carbohydrates-PDF.pdf"
researchEvidence:
  designKind: "narrative_review"
  designLabel: "narrative_review"
  populationLabel: "FDA dietary-fiber labeling review context."
  durationLabel: "Narrative/regulatory review; no single intervention duration."
  aggregateRole: "context"
  cohortKey: "fda-non-digestible-carbohydrates-review-2018-06-14"
  notes:
    - "Participant count is not applicable or not reported for this regulatory/guideline/context source."
evidenceBucket: "Regulatory, guideline, and external health-claim context"
whyItMatters: "Clarifies why psyllium husk is treated as dietary fiber for FDA labeling and claim purposes."
potentialMurphEndpoints:
  - "soluble fiber identity"
  - "label-claim eligibility"
  - "LDL-C"
  - "total cholesterol"
protocolTakeaway: "Useful for FDA dietary-fiber status and claim boundaries; not sufficient as standalone efficacy support."
murphTakeaway: "FDA recognizes psyllium husk within the dietary-fiber/CHD risk-reduction regulatory pathway, but the protocol should cite trial-level sources for expected LDL-C change."
studyDesign: "narrative_review"
modality: "psyllium husk / soluble fiber cholesterol context"
claimUse: "context-only"
sourceFindings:
  -
    findingId: "finding:fda-non-digestible-carbohydrates-review-2018-06-14-fda-dietary-fiber-status"
    sourceKey: "source_artifact:fda-non-digestible-carbohydrates-review-2018-06-14"
    extractedFromArtifactId: "art_fda_non_digestible_carbohydrates_review_2018_06_14_pdf"
    findingKind: "context"
    population: "U.S. dietary-fiber labeling context."
    exposure: "Psyllium husk from Plantago ovata seed coat."
    outcome: "Dietary fiber status and CHD health-claim linkage."
    summary: "FDA's review identifies psyllium husk as an added non-digestible carbohydrate meeting the dietary-fiber definition based on the existing soluble-fiber/CHD claim regulation."
    evidenceUse:
      - "context"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
extractionNotes:
  batchId: "batch-006"
  evidenceBucket: "Regulatory, guideline, and external health-claim context"
  participantCountNote: "No source-level participant count was applicable or extractable for this context batch unless an included-study count is explicitly listed."
  claimUseBoundary: "context-only; do not use as primary efficacy evidence for the protocol."
populationMismatch: "Labeling/science-review context rather than participant-level adult protocol data."
limitations: "Regulatory science review, not a primary efficacy trial or a dose-response protocol study."
safetyNotes: "No source-specific adverse-event extraction in this batch beyond general regulatory context."
---
This source is included for **Regulatory, guideline, and external health-claim context**.

**Findings:** FDA identifies psyllium husk as a dietary fiber recognized through existing soluble-fiber/CHD claim regulations; no new source-specific effect estimate was extracted from this review page.

**Why it matters:** Clarifies why psyllium husk is treated as dietary fiber for FDA labeling and claim purposes.

**Potential experiment signals:** soluble fiber identity, label-claim eligibility, LDL-C, total cholesterol

**Protocol takeaway:** Useful for FDA dietary-fiber status and claim boundaries; not sufficient as standalone efficacy support.

**Claim use:** `context-only`.

## Extracted source fields

- **Participant count:** Not applicable or not reported for this context source.
- **Participant count kind:** Not applicable/not extracted.
- **Population:** FDA dietary-fiber labeling review context.
- **Intervention / exposure:** Psyllium husk as an added non-digestible carbohydrate and soluble fiber source.
- **Comparator / control:** Other reviewed non-digestible carbohydrates or dietary fibers.
- **Duration / follow-up:** Narrative/regulatory review; no single intervention duration.
- **Endpoints:** dietary fiber definition, CHD risk claim, LDL-C, total cholesterol
- **Adverse events / safety notes:** No source-specific adverse-event extraction in this batch beyond general regulatory context.
- **Limitations:** Regulatory science review, not a primary efficacy trial or a dose-response protocol study.
- **Population mismatch:** Labeling/science-review context rather than participant-level adult protocol data.
- **Directness to Psyllium Husk For Cholesterol:** general_guideline
- **Artifact / rights notes:** PDF candidate available; rights status open_access.

## Source-owned findings

- `finding:fda-non-digestible-carbohydrates-review-2018-06-14-fda-dietary-fiber-status` — FDA's review identifies psyllium husk as an added non-digestible carbohydrate meeting the dietary-fiber definition based on the existing soluble-fiber/CHD claim regulation.
