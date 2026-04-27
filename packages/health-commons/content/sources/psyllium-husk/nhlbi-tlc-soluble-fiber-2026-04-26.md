---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:nhlbi-tlc-soluble-fiber-2026-04-26"
slug: "sources/psyllium-husk/nhlbi-tlc-soluble-fiber-2026-04-26"
title: "Your Guide to Lowering Your Cholesterol With TLC"
summary: "NHLBI TLC guide with soluble-fiber intake targets and practical dietary implementation, including psyllium as a soluble-fiber source."
status: "draft"
quality: "usable"
aliases:
  - "nhlbi-tlc-soluble-fiber-2026-04-26"
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
  kind: "guideline"
  title: "Your Guide to Lowering Your Cholesterol With TLC"
  authors: "National Heart, Lung, and Blood Institute"
  year: 2005
  journal: "NHLBI / NIH patient guideline"
  citation: "National Heart, Lung, and Blood Institute. Your Guide to Lowering Your Cholesterol With TLC. NHLBI / NIH patient guideline. 2005. URL: https://www.nhlbi.nih.gov/files/docs/public/heart/chol_tlc.pdf."
  url: "https://www.nhlbi.nih.gov/files/docs/public/heart/chol_tlc.pdf"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "59839091c2c960473929498210c41e0ebf581a6fdfec2e65ec56473d2159391d"
    url: "https://www.nhlbi.nih.gov/files/docs/public/heart/chol_tlc.pdf"
  canonicalUrl: "https://www.nhlbi.nih.gov/files/docs/public/heart/chol_tlc.pdf"
researchEvidence:
  designKind: "guideline"
  designLabel: "guideline"
  populationLabel: "People following Therapeutic Lifestyle Changes to lower LDL cholesterol."
  durationLabel: "Lifestyle guide; no fixed psyllium intervention duration."
  aggregateRole: "context"
  cohortKey: "nhlbi-tlc-soluble-fiber-2026-04-26"
  notes:
    - "Participant count is not applicable or not reported for this regulatory/guideline/context source."
evidenceBucket: "Regulatory, guideline, and external health-claim context"
whyItMatters: "Frames soluble-fiber dosing and common tolerability issues."
potentialMurphEndpoints:
  - "daily soluble fiber grams"
  - "LDL-C"
  - "GI cramps"
  - "bloating"
protocolTakeaway: "Use for TLC soluble-fiber context; do not treat as direct psyllium efficacy evidence."
murphTakeaway: "TLC guidance suggests tracking soluble fiber dose and GI symptoms during titration."
studyDesign: "guideline"
modality: "psyllium husk / soluble fiber cholesterol context"
claimUse: "context-only"
sourceFindings:
  -
    findingId: "finding:nhlbi-tlc-soluble-fiber-2026-04-26-tlc-soluble-fiber-dose-context"
    sourceKey: "source_artifact:nhlbi-tlc-soluble-fiber-2026-04-26"
    extractedFromArtifactId: "art_nhlbi_tlc_soluble_fiber_2026_04_26_pdf"
    findingKind: "context"
    population: "People following TLC diet guidance for LDL-C reduction."
    exposure: "Added soluble fiber including psyllium as one source."
    outcome: "LDL-C lowering and diet implementation."
    summary: "NHLBI's TLC guide states that adding 5-10 g/day soluble fiber can reduce LDL-C by about 5% and lists higher soluble-fiber targets within diet therapy; it is general soluble-fiber context rather than psyllium-specific trial evidence."
    evidenceUse:
      - "context"
  -
    findingId: "finding:nhlbi-tlc-soluble-fiber-2026-04-26-tlc-fiber-tolerability"
    sourceKey: "source_artifact:nhlbi-tlc-soluble-fiber-2026-04-26"
    extractedFromArtifactId: "art_nhlbi_tlc_soluble_fiber_2026_04_26_pdf"
    findingKind: "safety"
    population: "People increasing dietary soluble fiber."
    exposure: "Rapid increase in fiber intake."
    outcome: "GI cramps or bloating."
    summary: "The TLC guide notes that increasing fiber too suddenly can cause cramps or bloating, supporting gradual titration in protocol design."
    evidenceUse:
      - "safety"
      - "context"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
extractionNotes:
  batchId: "batch-006"
  evidenceBucket: "Regulatory, guideline, and external health-claim context"
  participantCountNote: "No source-level participant count was applicable or extractable for this context batch unless an included-study count is explicitly listed."
  claimUseBoundary: "context-only; do not use as primary efficacy evidence for the protocol."
populationMismatch: "Dietary lifestyle guidance rather than source-owned psyllium protocol data."
limitations: "Broad lifestyle guide, not a psyllium-specific trial."
safetyNotes: "The guide warns that sudden fiber increase may cause cramps or bloating."
---
This source is included for **Regulatory, guideline, and external health-claim context**.

**Findings:** The guide says adding 5-10 g/day soluble fiber can reduce LDL-C by about 5%, and TLC prefers 10-25 g/day soluble fiber as part of diet therapy; this is lifestyle-guideline context.

**Why it matters:** Frames soluble-fiber dosing and common tolerability issues.

**Potential experiment signals:** daily soluble fiber grams, LDL-C, GI cramps, bloating

**Protocol takeaway:** Use for TLC soluble-fiber context; do not treat as direct psyllium efficacy evidence.

**Claim use:** `context-only`.

## Extracted source fields

- **Participant count:** Not applicable or not reported for this context source.
- **Participant count kind:** Not applicable/not extracted.
- **Population:** People following Therapeutic Lifestyle Changes to lower LDL cholesterol.
- **Intervention / exposure:** Soluble fiber intake targets, including psyllium seed/ground psyllium examples.
- **Comparator / control:** Usual diet or lower soluble-fiber intake.
- **Duration / follow-up:** Lifestyle guide; no fixed psyllium intervention duration.
- **Endpoints:** LDL-C, soluble fiber intake, GI tolerance
- **Adverse events / safety notes:** The guide warns that sudden fiber increase may cause cramps or bloating.
- **Limitations:** Broad lifestyle guide, not a psyllium-specific trial.
- **Population mismatch:** Dietary lifestyle guidance rather than source-owned psyllium protocol data.
- **Directness to Psyllium Husk For Cholesterol:** same_mechanism
- **Artifact / rights notes:** PDF candidate available; rights status open_access.

## Source-owned findings

- `finding:nhlbi-tlc-soluble-fiber-2026-04-26-tlc-soluble-fiber-dose-context` — NHLBI's TLC guide states that adding 5-10 g/day soluble fiber can reduce LDL-C by about 5% and lists higher soluble-fiber targets within diet therapy; it is general soluble-fiber context rather than psyllium-specific trial evidence.
- `finding:nhlbi-tlc-soluble-fiber-2026-04-26-tlc-fiber-tolerability` — The TLC guide notes that increasing fiber too suddenly can cause cramps or bloating, supporting gradual titration in protocol design.
