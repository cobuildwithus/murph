---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct05823727-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct05823727-2026-04-25
title: Collagen Peptide Supplementation After Total Knee Arthroplasty
summary: Active/enrolling registry record for 10 g/day SOLUGEL collagen peptides versus maltodextrin placebo around total knee arthroplasty; no results extracted, included as postoperative clinical boundary evidence.
status: draft
quality: usable
aliases:
- NCT05823727
- Collagen peptide supplementation after TKA
- SOLUGEL TKA collagen peptides
categories:
- collagen-supplementation
- clinical-supervised-wound-nutrition
- clinical_supervised
- context-only
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
    registryId: NCT05823727
    url: https://clinicaltrials.gov/study/NCT05823727
  canonicalUrl: https://clinicaltrials.gov/study/NCT05823727
  identityAliases:
  - NCT05823727
  - Collagen peptide supplementation after TKA
  - SOLUGEL TKA collagen peptides
  - Collagen Peptide Supplementation After Total Knee Arthroplasty
source:
  kind: web_page
  title: Collagen Peptide Supplementation After Total Knee Arthroplasty
  authors: University of Arkansas
  citation: ClinicalTrials.gov. Effects of Collagen Peptide Supplementation on Connective Tissue Remodeling, Functional Outcomes, and Wound Healing After Total Knee Arthroplasty (TKA). NCT05823727. Accessed 2026-04-25. https://clinicaltrials.gov/study/NCT05823727.
  year: 2026
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT05823727
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Randomized double-blind placebo-controlled clinical trial registry record
  populationLabel: Adults aged 50-75 with primary knee osteoarthritis scheduled for total knee arthroplasty at UAMS.
  durationLabel: 24 weeks of supplementation with perioperative assessments
  cohortKey: total-knee-arthroplasty
  participantCount: 44
  participantCountKind: approximate
  aggregateRole: primary
evidenceBucket: clinical-supervised-wound-nutrition
whyItMatters: Shows ongoing interest in perioperative collagen peptides, wound healing, and connective tissue remodeling, while preserving no-results status.
potentialMurphEndpoints:
- KOOS
- VR-12
- POMS
- pain
- range of motion
- wound healing
- DXA/BIA body composition
- tissue biomarkers
- compliance
protocolTakeaway: 'Context-only/unpublished: do not cite for outcomes; keep as a research-watch boundary for postoperative care.'
murphTakeaway: Post-TKA supplementation is medical-care research, not a self-run wellness experiment.
studyDesign: registered randomized controlled trial
modality: 10 g/day SOLUGEL collagen peptides versus 10 g/day maltodextrin placebo
claimUse: context-only
murphV1Priority: Low
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: clinical-supervised-wound-nutrition
  directness: clinical_supervised
  claimUse: context-only
  priority: low
  batchId: batch-011
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **clinical-supervised-wound-nutrition**.

**Findings:**

- The registry describes a randomized, double-blind, placebo-controlled trial with 44 estimated participants and two arms. `[source_artifact:clinicaltrials-gov-nct05823727-2026-04-25]`
- The experimental arm receives 10 g/day SOLUGEL collagen peptides for 24 weeks; the placebo arm receives 10 g/day maltodextrin for 24 weeks. `[source_artifact:clinicaltrials-gov-nct05823727-2026-04-25]`
- Outcomes and assessments include connective-tissue remodeling samples, wound healing, knee function, pain, range of motion, mood/quality-of-life questionnaires, DXA/BIA, grip strength, dietary logs, and compliance. No efficacy results were available in the extracted record. `[source_artifact:clinicaltrials-gov-nct05823727-2026-04-25]`

**Why it matters:** Shows ongoing interest in perioperative collagen peptides, wound healing, and connective tissue remodeling, while preserving no-results status. `[source_artifact:clinicaltrials-gov-nct05823727-2026-04-25]`

**Potential experiment signals:**

  - "KOOS"
  - "VR-12"
  - "POMS"
  - "pain"
  - "range of motion"
  - "wound healing"
  - "DXA/BIA body composition"
  - "tissue biomarkers"
  - "compliance"

**Protocol takeaway:** Context-only/unpublished: do not cite for outcomes; keep as a research-watch boundary for postoperative care. `[source_artifact:clinicaltrials-gov-nct05823727-2026-04-25]`

**Population mismatch:** Adults aged 50-75 with primary knee osteoarthritis scheduled for total knee arthroplasty at UAMS.

**Limitations:**

- Registry record only; no results extracted.
- Perioperative total knee arthroplasty population.
- Intervention occurs alongside surgery, physical therapy, physician visits, and clinical monitoring.
- Status can change after the access date.

**Claim use:** `context-only`.
