---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct06937801-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct06937801-2026-04-25
title: Gastrointestinal Tolerability of a Single Dose of Collagen Hydrolysate
summary: A registry record describes a double-blind placebo-controlled collagen peptide trial for GI discomfort in healthy adults with GI symptoms, with no results extracted.
status: draft
quality: usable
aliases:
- Gastrointestinal Tolerability of a Single Dose of Collagen Hydrolysate
- NCT06937801
categories:
- collagen-supplementation
- safety-quality-contaminants
- safety_boundary
- safety-only
relations:
-
  type: related_protocol
  target: protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides
-
  type: parent_family
  target: experiment_family:collagen-supplementation
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT06937801
    url: https://clinicaltrials.gov/study/NCT06937801
  canonicalUrl: https://clinicaltrials.gov/study/NCT06937801
  identityAliases:
  - Gastrointestinal Tolerability of a Single Dose of Collagen Hydrolysate
  - NCT06937801
source:
  kind: web_page
  title: Gastrointestinal Tolerability of a Single Dose of Collagen Hydrolysate
  authors: ClinicalTrials.gov; Rousselot BVBA
  citation: ClinicalTrials.gov. NCT06937801. To Assess the Effect of Collagen on Gastrointestinal Discomfort in Healthy Adults With Gastrointestinal Symptoms. Accessed April 25, 2026.
  year: 2026
  journal: ClinicalTrials.gov registry record
  url: https://clinicaltrials.gov/study/NCT06937801
researchEvidence:
  designKind: other
  designLabel: Registered double-blind placebo-controlled trial; no posted results extracted
  populationLabel: Healthy adults aged 18-64 with perceived gastrointestinal symptoms / GSRS average score 2-5, according to accessible registry mirror text
  durationLabel: Protocol duration not verified in accessible official text; registry record has no results extracted
  cohortKey: batch-009:clinicaltrials-gov-nct06937801-2026-04-25
  aggregateRole: primary
evidenceBucket: safety-quality-contaminants
whyItMatters: Identifies an unpublished safety/tolerability research direction without contributing outcome evidence.
potentialMurphEndpoints:
- safety:gastrointestinal-tolerability
- outcome:GI-discomfort
- registry:unpublished-trial
protocolTakeaway: Use source_artifact:clinicaltrials-gov-nct06937801-2026-04-25 as unpublished registry context only.
murphTakeaway: Good watchlist item for future GI tolerability evidence; not ready for protocol claims.
studyDesign: Registered double-blind placebo-controlled trial; no posted results extracted
modality: registered oral collagen peptide trial
claimUse: safety-only
murphV1Priority: Low
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: safety-quality-contaminants
  directness: safety_boundary
  claimUse: safety-only
  priority: low
  batchId: batch-009
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **safety-quality-contaminants**.

**Findings:** Population/exposure: Healthy adults aged 18-64 with perceived gastrointestinal symptoms / GSRS average score 2-5, according to accessible registry mirror text Intervention or exposure: Animal-sourced collagen peptide powder mixed with water and taken orally. Comparator/control: Placebo. Duration/follow-up: Protocol duration not verified in accessible official text; registry record has no results extracted Endpoints: gastrointestinal discomfort, gut microbiota composition, gut permeability, mood, anxiety, perceived stress, quality of life, cognitive function, tolerability. Direction/effect: No results were available in the accessible registry extraction; this is unpublished protocol context only. Safety notes: Eligibility excludes known sensitivity, intolerability, or allergy to study products/excipients; no adverse-event results posted in accessible extraction. Limitations: Registry record only; no peer-reviewed or posted results extracted.; Official ClinicalTrials.gov page was dynamically limited in accessible text, so some details came from search/mirror snippets and should be rechecked.; Cannot support efficacy or safety outcome claims.. Population mismatch: Planned/registered trial, not completed evidence.

**Why it matters:** Identifies an unpublished safety/tolerability research direction without contributing outcome evidence.

**Potential experiment signals:** safety:gastrointestinal-tolerability, outcome:GI-discomfort, registry:unpublished-trial.

**Protocol takeaway:** Use source_artifact:clinicaltrials-gov-nct06937801-2026-04-25 as unpublished registry context only.

**Claim use:** `safety-only`. Directness: `safety_boundary`. Rights status guess: `unknown`.
