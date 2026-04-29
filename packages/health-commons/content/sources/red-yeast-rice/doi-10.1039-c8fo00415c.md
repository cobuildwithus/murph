---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1039-c8fo00415c"
slug: "sources/red-yeast-rice/doi-10.1039-c8fo00415c"
title: "The short-term supplementation of monacolin K improves the lipid and metabolic patterns of hypertensive and hypercholesterolemic subjects at low cardiovascular risk"
summary: "After one month, the treatment group showed reductions in total cholesterol and LDL-C; between-treatment reductions were reported as 9.19% for total cholesterol and 12.29% for LDL-C, with HDL-C unchanged."
status: "draft"
quality: "usable"
aliases:
  - "doi-10.1039-c8fo00415c"
  - "The short-term supplementation of monacolin K improves the lipid and metabolic patterns of hypertensive and hypercholesterolemic subjects at low cardiovascular risk"
categories:
  - "red-yeast-rice"
  - "adjacent-combination-evidence"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "journal_article"
  title: "The short-term supplementation of monacolin K improves the lipid and metabolic patterns of hypertensive and hypercholesterolemic subjects at low cardiovascular risk"
  authors: "Alberto Mazza et al."
  journal: "Food & Function"
  citation: "Alberto Mazza et al. 2018. The short-term supplementation of monacolin K improves the lipid and metabolic patterns of hypertensive and hypercholesterolemic subjects at low cardiovascular risk. Food & Function. doi:10.1039/c8fo00415c"
  year: 2018
  doi: "10.1039/c8fo00415c"
  url: "https://doi.org/10.1039/C8FO00415C"
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.1039/c8fo00415c"
    titleHash: "bfb6cda593b133e497b0e09ed840011e7a98cf6737e9d7d8f0282492fe70ca49"
    url: "https://doi.org/10.1039/C8FO00415C"
  canonicalUrl: "https://doi.org/10.1039/C8FO00415C"
researchEvidence:
  designKind: "randomized_controlled_trial"
  designLabel: "open-label randomized single-site post-market study"
  populationLabel: "Hypertensive and hypercholesterolemic subjects at low cardiovascular risk."
  durationLabel: "1 month."
  aggregateRole: "primary"
  cohortKey: "cohort_doi_10_1039_c8fo00415c"
  notes:
    - "Comparator/control: Diet-only control group."
    - "Population mismatch: Multi-ingredient monacolin product in hypertensive/hypercholesterolemic participants, not plain OTC RYR."
    - "Limitations: Short duration, single site, open-label design, and multi-ingredient formulation limit attribution to RYR alone."
  participantCount: 60
  participantCountKind: "reported"
evidenceBucket: "Adjacent combinations and special-population evidence"
whyItMatters: "Useful for monacolin-dose context but formulation includes additional active ingredients; do not treat as pure RYR evidence."
potentialMurphEndpoints:
  - "ldl-c"
  - "total-cholesterol"
  - "triglycerides"
  - "hdl-c"
  - "creatine-kinase"
  - "alanine-aminotransferase"
  - "serum-creatinine"
  - "adverse-events"
protocolTakeaway: "Do not use as a direct plain red-yeast-rice efficacy claim unless a separable RYR-only arm is verified; use for boundary/context only."
murphTakeaway: "After one month, the treatment group showed reductions in total cholesterol and LDL-C; between-treatment reductions were reported as 9.19% for total cholesterol and 12.29% for LDL-C, with HDL-C unchanged. For Murph, the usable takeaway is the boundary: Multi-ingredient monacolin product in hypertensive/hypercholesterolemic participants, not plain OTC RYR."
studyDesign: "open-label randomized single-site post-market study"
modality: "oral multi-ingredient monacolin supplement"
claimUse: "context-only"
sourceFindings:

  -
    findingId: "finding:doi-10.1039-c8fo00415c-adjacent"
    sourceKey: "source_artifact:doi-10.1039-c8fo00415c"
    findingKind: "intervention_result"
    population: "Hypertensive and hypercholesterolemic subjects at low cardiovascular risk."
    exposure: "Nutraceutical tablet containing red yeast rice 333 mg standardized to 10 mg monacolin K plus policosanols, resveratrol, chromium picolinate, and black pepper/piperine."
    outcome: "Total cholesterol, LDL-C, triglycerides, glucose, HDL-C, and safety labs."
    summary: "After one month, the treatment group showed reductions in total cholesterol and LDL-C; between-treatment reductions were reported as 9.19% for total cholesterol and 12.29% for LDL-C, with HDL-C unchanged. Boundary: Short duration, single site, open-label design, and multi-ingredient formulation limit attribution to RYR alone."
    evidenceUse:
      - "adjacent_variant"
      - "efficacy"
      - "safety"
murphV1Priority: "Medium"
pdfRightsStatus: "permission_required"
---
This source is included for **Adjacent combinations and special-population evidence**.

**Findings:** After one month, the treatment group showed reductions in total cholesterol and LDL-C; between-treatment reductions were reported as 9.19% for total cholesterol and 12.29% for LDL-C, with HDL-C unchanged.

**Why it matters:** Useful for monacolin-dose context but formulation includes additional active ingredients; do not treat as pure RYR evidence.

**Potential experiment signals:** ldl-c, total-cholesterol, triglycerides, hdl-c, creatine-kinase, alanine-aminotransferase, serum-creatinine, adverse-events.

**Protocol takeaway:** Do not promote this source to a direct plain red yeast rice claim without a separable RYR-only arm. Preserve the boundary: Multi-ingredient monacolin product in hypertensive/hypercholesterolemic participants, not plain OTC RYR.

**Claim use:** `context-only`.

**Comparator/control:** Diet-only control group.

**Duration/follow-up:** 1 month.

**Safety/adverse events:** AST, ALT, creatine kinase, and serum creatinine did not significantly change, and no adverse event was reported.

**Limitations:** Short duration, single site, open-label design, and multi-ingredient formulation limit attribution to RYR alone.
