---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:ncbi-endotext-diet-lipids-2024-03-31"
slug: "sources/psyllium-husk/ncbi-endotext-diet-lipids-2024-03-31"
title: "The Effect of Diet on Cardiovascular Disease and Lipid and Lipoprotein Levels"
summary: "Endotext chapter summarizing diet effects on lipids; provides soluble-fiber and psyllium context, mechanisms, and meta-analytic background."
status: "draft"
quality: "usable"
aliases:
  - "ncbi-endotext-diet-lipids-2024-03-31"
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
  kind: "book"
  title: "The Effect of Diet on Cardiovascular Disease and Lipid and Lipoprotein Levels"
  authors: "Feingold KR"
  year: 2024
  journal: "Endotext"
  citation: "Feingold KR. The Effect of Diet on Cardiovascular Disease and Lipid and Lipoprotein Levels. Endotext. 2024. URL: https://www.ncbi.nlm.nih.gov/books/NBK570127/."
  url: "https://www.ncbi.nlm.nih.gov/books/NBK570127/"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "3f5410f1f66e44aaf9c0b85ab16a6ac7b8e9a47926a483fd56c034d43946ae30"
    url: "https://www.ncbi.nlm.nih.gov/books/NBK570127/"
  canonicalUrl: "https://www.ncbi.nlm.nih.gov/books/NBK570127/"
researchEvidence:
  designKind: "narrative_review"
  designLabel: "narrative_review"
  populationLabel: "Adults and cardiometabolic-risk populations in diet/lipid management context."
  durationLabel: "Narrative review; no single duration."
  aggregateRole: "context"
  cohortKey: "ncbi-endotext-diet-lipids-2024-03-31"
  notes:
    - "Participant count is not applicable or not reported for this regulatory/guideline/context source."
evidenceBucket: "Regulatory, guideline, and external health-claim context"
whyItMatters: "Provides mechanism and broad diet-therapy context for interpreting cholesterol changes."
potentialMurphEndpoints:
  - "LDL-C"
  - "total cholesterol"
  - "HDL-C"
  - "triglycerides"
  - "dietary fiber grams"
  - "mechanism"
protocolTakeaway: "Use for background and mechanism only; protocol efficacy should cite primary meta-analyses or RCTs."
murphTakeaway: "Soluble fiber plausibly lowers LDL-C through intestinal cholesterol/bile-acid effects, but this chapter is a secondary source."
studyDesign: "narrative_review"
modality: "psyllium husk / soluble fiber cholesterol context"
claimUse: "context-only"
sourceFindings:
  -
    findingId: "finding:ncbi-endotext-diet-lipids-2024-03-31-soluble-fiber-lipid-review-context"
    sourceKey: "source_artifact:ncbi-endotext-diet-lipids-2024-03-31"
    findingKind: "context"
    population: "Adults and cardiometabolic-risk populations in diet/lipid literature."
    exposure: "Dietary fiber and psyllium."
    outcome: "LDL-C and total cholesterol."
    summary: "Endotext summarizes dietary-fiber and psyllium evidence as lowering LDL-C and total cholesterol in secondary analyses, while not serving as primary protocol evidence."
    evidenceUse:
      - "context"
  -
    findingId: "finding:ncbi-endotext-diet-lipids-2024-03-31-bile-acid-mechanism-context"
    sourceKey: "source_artifact:ncbi-endotext-diet-lipids-2024-03-31"
    findingKind: "mechanistic"
    population: "General lipid-metabolism context."
    exposure: "Water-soluble fiber/psyllium."
    outcome: "Reduced cholesterol and bile-acid absorption; LDL receptor effects."
    summary: "The chapter describes a plausible mechanism in which water-soluble fiber decreases cholesterol and bile-acid absorption, supporting LDL-C lowering through hepatic cholesterol handling."
    evidenceUse:
      - "mechanism"
      - "context"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
extractionNotes:
  batchId: "batch-006"
  evidenceBucket: "Regulatory, guideline, and external health-claim context"
  participantCountNote: "No source-level participant count was applicable or extractable for this context batch unless an included-study count is explicitly listed."
  claimUseBoundary: "context-only; do not use as primary efficacy evidence for the protocol."
populationMismatch: "Broad diet/lipid review rather than protocol-specific trial."
limitations: "Narrative review; effect estimates are secondary summaries rather than source-owned primary results."
safetyNotes: "No batch-specific adverse-event rate extracted."
---
This source is included for **Regulatory, guideline, and external health-claim context**.

**Findings:** The chapter summarizes meta-analytic context including fiber lowering total cholesterol and LDL-C, and reports psyllium-specific decreases in LDL-C without significant HDL-C or triglyceride changes in cited analyses.

**Why it matters:** Provides mechanism and broad diet-therapy context for interpreting cholesterol changes.

**Potential experiment signals:** LDL-C, total cholesterol, HDL-C, triglycerides, dietary fiber grams, mechanism

**Protocol takeaway:** Use for background and mechanism only; protocol efficacy should cite primary meta-analyses or RCTs.

**Claim use:** `context-only`.

## Extracted source fields

- **Participant count:** Not applicable or not reported for this context source.
- **Participant count kind:** Not applicable/not extracted.
- **Population:** Adults and cardiometabolic-risk populations in diet/lipid management context.
- **Intervention / exposure:** Dietary fiber and psyllium within broader dietary patterns.
- **Comparator / control:** Lower-fiber or usual-diet comparators in summarized trials/meta-analyses.
- **Duration / follow-up:** Narrative review; no single duration.
- **Endpoints:** LDL-C, total cholesterol, HDL-C, triglycerides, mechanism
- **Adverse events / safety notes:** No batch-specific adverse-event rate extracted.
- **Limitations:** Narrative review; effect estimates are secondary summaries rather than source-owned primary results.
- **Population mismatch:** Broad diet/lipid review rather than protocol-specific trial.
- **Directness to Psyllium Husk For Cholesterol:** general_guideline
- **Artifact / rights notes:** No downloadable artifact candidate required for this batch; rights status open_access.

## Source-owned findings

- `finding:ncbi-endotext-diet-lipids-2024-03-31-soluble-fiber-lipid-review-context` — Endotext summarizes dietary-fiber and psyllium evidence as lowering LDL-C and total cholesterol in secondary analyses, while not serving as primary protocol evidence.
- `finding:ncbi-endotext-diet-lipids-2024-03-31-bile-acid-mechanism-context` — The chapter describes a plausible mechanism in which water-soluble fiber decreases cholesterol and bile-acid absorption, supporting LDL-C lowering through hepatic cholesterol handling.
