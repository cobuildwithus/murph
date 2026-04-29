---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:lipid-org-adding-soluble-fiber-2026-04-26"
slug: "sources/psyllium-husk/lipid-org-adding-soluble-fiber-2026-04-26"
title: "Adding Soluble Fiber to Lower Your Cholesterol"
summary: "National Lipid Association patient-facing handout on increasing soluble fiber; includes implementation and hydration advice relevant to psyllium use."
status: "draft"
quality: "usable"
aliases:
  - "lipid-org-adding-soluble-fiber-2026-04-26"
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
  title: "Adding Soluble Fiber to Lower Your Cholesterol"
  authors: "National Lipid Association"
  year: 2016
  journal: "National Lipid Association patient handout"
  citation: "National Lipid Association. Adding Soluble Fiber to Lower Your Cholesterol. National Lipid Association patient handout. 2016. URL: https://www.lipid.org/sites/default/files/adding_soluble_fiber_final_0.pdf."
  url: "https://www.lipid.org/sites/default/files/adding_soluble_fiber_final_0.pdf"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "d044ca141f1f84a89c7b2da822ed199ad8bf735bf9ca1b42ff0fbce5e644dee3"
    url: "https://www.lipid.org/sites/default/files/adding_soluble_fiber_final_0.pdf"
  canonicalUrl: "https://www.lipid.org/sites/default/files/adding_soluble_fiber_final_0.pdf"
researchEvidence:
  designKind: "guideline"
  designLabel: "guideline"
  populationLabel: "Patients seeking dietary cholesterol reduction."
  durationLabel: "Patient guidance; no fixed intervention duration."
  aggregateRole: "context"
  cohortKey: "lipid-org-adding-soluble-fiber-2026-04-26"
  notes:
    - "Participant count is not applicable or not reported for this regulatory/guideline/context source."
evidenceBucket: "Regulatory, guideline, and external health-claim context"
whyItMatters: "Useful implementation context for dose titration and hydration language."
potentialMurphEndpoints:
  - "daily soluble fiber grams"
  - "LDL-C"
  - "total cholesterol"
  - "hydration"
  - "GI tolerance"
protocolTakeaway: "Use for external protocol-safety framing, not as primary efficacy evidence."
murphTakeaway: "The handout reinforces slow titration and extra water when using psyllium."
studyDesign: "guideline"
modality: "psyllium husk / soluble fiber cholesterol context"
claimUse: "context-only"
sourceFindings:

  -
    findingId: "finding:lipid-org-adding-soluble-fiber-2026-04-26-soluble-fiber-handout-dose-hydration"
    sourceKey: "source_artifact:lipid-org-adding-soluble-fiber-2026-04-26"
    extractedFromArtifactId: "art_lipid_org_adding_soluble_fiber_2026_04_26_pdf"
    findingKind: "context"
    population: "Patients seeking cholesterol-lowering diet changes."
    exposure: "Soluble fiber increase including psyllium supplementation."
    outcome: "Total and LDL cholesterol plus hydration/tolerability implementation."
    summary: "The National Lipid Association handout states that 5-10 g/day soluble fiber may lower total and LDL cholesterol by about 5 to 11 points and advises starting psyllium at a small dose, mixing with water, increasing slowly, and drinking extra water."
    evidenceUse:
      - "context"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
extractionNotes:
  batchId: "batch-006"
  evidenceBucket: "Regulatory, guideline, and external health-claim context"
  participantCountNote: "No source-level participant count was applicable or extractable for this context batch unless an included-study count is explicitly listed."
  claimUseBoundary: "context-only; do not use as primary efficacy evidence for the protocol."
populationMismatch: "General patient education rather than protocol evidence."
limitations: "Patient handout; does not provide trial-level extraction or source-specific effect details."
safetyNotes: "Advises starting with a small dose, mixing psyllium with water, increasing slowly, and drinking extra water."
---
This source is included for **Regulatory, guideline, and external health-claim context**.

**Findings:** The handout states that 5-10 g/day soluble fiber can help lower total and LDL cholesterol by about 5 to 11 points; this is an external patient-education claim, not primary trial evidence.

**Why it matters:** Useful implementation context for dose titration and hydration language.

**Potential experiment signals:** daily soluble fiber grams, LDL-C, total cholesterol, hydration, GI tolerance

**Protocol takeaway:** Use for external protocol-safety framing, not as primary efficacy evidence.

**Claim use:** `context-only`.

## Extracted source fields

- **Participant count:** Not applicable or not reported for this context source.
- **Participant count kind:** Not applicable/not extracted.
- **Population:** Patients seeking dietary cholesterol reduction.
- **Intervention / exposure:** 5-10 g/day added soluble fiber; psyllium as one implementation option.
- **Comparator / control:** Usual diet without added soluble fiber.
- **Duration / follow-up:** Patient guidance; no fixed intervention duration.
- **Endpoints:** LDL-C, total cholesterol, dose implementation, hydration
- **Adverse events / safety notes:** Advises starting with a small dose, mixing psyllium with water, increasing slowly, and drinking extra water.
- **Limitations:** Patient handout; does not provide trial-level extraction or source-specific effect details.
- **Population mismatch:** General patient education rather than protocol evidence.
- **Directness to Psyllium Husk For Cholesterol:** same_mechanism
- **Artifact / rights notes:** PDF candidate available; rights status open_access.

## Source-owned findings

- `finding:lipid-org-adding-soluble-fiber-2026-04-26-soluble-fiber-handout-dose-hydration` — The National Lipid Association handout states that 5-10 g/day soluble fiber may lower total and LDL cholesterol by about 5 to 11 points and advises starting psyllium at a small dose, mixing with water, increasing slowly, and drinking extra water.
