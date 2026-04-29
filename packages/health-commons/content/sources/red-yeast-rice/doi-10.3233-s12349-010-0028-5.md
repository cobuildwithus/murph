---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.3233-s12349-010-0028-5"
slug: "sources/red-yeast-rice/doi-10.3233-s12349-010-0028-5"
title: "Efficacy of a red yeast rice based nutraceutical in large subgroups of hypercholesterolemic subjects in every day clinical practice"
summary: "The source is a pragmatic/product-specific clinical-practice report; accessible metadata did not provide extractable numeric lipid or adverse-event estimates for this batch."
status: "draft"
quality: "usable"
aliases:
  - "doi-10.3233-s12349-010-0028-5"
  - "Efficacy of a red yeast rice based nutraceutical in large subgroups of hypercholesterolemic subjects in every day clinical practice"
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
  title: "Efficacy of a red yeast rice based nutraceutical in large subgroups of hypercholesterolemic subjects in every day clinical practice"
  authors: "Arrigo F. G. Cicero; Claudio Benvenuti; ARMoweb Study Group"
  journal: "Mediterranean Journal of Nutrition and Metabolism"
  citation: "Arrigo F. G. Cicero; Claudio Benvenuti; ARMoweb Study Group. 2010. Efficacy of a red yeast rice based nutraceutical in large subgroups of hypercholesterolemic subjects in every day clinical practice. Mediterranean Journal of Nutrition and Metabolism. doi:10.3233/s12349-010-0028-5"
  year: 2010
  doi: "10.3233/s12349-010-0028-5"
  url: "https://doi.org/10.3233/S12349-010-0028-5"
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.3233/s12349-010-0028-5"
    titleHash: "f25e54d7c5fc11fc41fa7da175453d2792b28cfb85737eb25222563c90c055c6"
    url: "https://doi.org/10.3233/S12349-010-0028-5"
  canonicalUrl: "https://doi.org/10.3233/S12349-010-0028-5"
researchEvidence:
  designKind: "prospective_cohort"
  designLabel: "everyday-practice subgroup study"
  populationLabel: "Hypercholesterolemic subjects in everyday clinical practice."
  durationLabel: "Duration not extracted from accessible metadata."
  aggregateRole: "primary"
  cohortKey: "cohort_doi_10_3233_s12349_010_0028_5"
  notes:
    - "Comparator/control: Subgroup/pragmatic clinical-practice comparisons; no placebo-controlled RYR-only arm extracted."
    - "Population mismatch: Real-world RYR-based nutraceutical context rather than direct plain protocol evidence."
    - "Limitations: Pragmatic, product-specific, likely uncontrolled/subgroup evidence; not suitable for plain RYR efficacy estimates."
evidenceBucket: "Adjacent combinations and special-population evidence"
whyItMatters: "Useful for real-world tolerability/effectiveness context, but likely product-specific and not randomized placebo-controlled evidence."
potentialMurphEndpoints:
  - "total-cholesterol"
  - "adverse-events"
protocolTakeaway: "Do not use as a direct plain red-yeast-rice efficacy claim unless a separable RYR-only arm is verified; use for boundary/context only."
murphTakeaway: "The source is a pragmatic/product-specific clinical-practice report; accessible metadata did not provide extractable numeric lipid or adverse-event estimates for this batch. For Murph, the usable takeaway is the boundary: Real-world RYR-based nutraceutical context rather than direct plain protocol evidence."
studyDesign: "everyday-practice subgroup study"
modality: "pragmatic RYR-based nutraceutical context"
claimUse: "context-only"
sourceFindings:

  -
    findingId: "finding:doi-10.3233-s12349-010-0028-5-adjacent"
    sourceKey: "source_artifact:doi-10.3233-s12349-010-0028-5"
    findingKind: "context"
    population: "Hypercholesterolemic subjects in everyday clinical practice."
    exposure: "Red yeast rice-based nutraceutical product used in practice."
    outcome: "Lipids and tolerability."
    summary: "The source is a pragmatic/product-specific clinical-practice report; accessible metadata did not provide extractable numeric lipid or adverse-event estimates for this batch. Boundary: Pragmatic, product-specific, likely uncontrolled/subgroup evidence; not suitable for plain RYR efficacy estimates."
    evidenceUse:
      - "context"
      - "adjacent_variant"
      - "safety"
murphV1Priority: "Medium"
pdfRightsStatus: "permission_required"
---
This source is included for **Adjacent combinations and special-population evidence**.

**Findings:** The source is a pragmatic/product-specific clinical-practice report; accessible metadata did not provide extractable numeric lipid or adverse-event estimates for this batch.

**Why it matters:** Useful for real-world tolerability/effectiveness context, but likely product-specific and not randomized placebo-controlled evidence.

**Potential experiment signals:** total-cholesterol, adverse-events.

**Protocol takeaway:** Do not promote this source to a direct plain red yeast rice claim without a separable RYR-only arm. Preserve the boundary: Real-world RYR-based nutraceutical context rather than direct plain protocol evidence.

**Claim use:** `context-only`.

**Comparator/control:** Subgroup/pragmatic clinical-practice comparisons; no placebo-controlled RYR-only arm extracted.

**Duration/follow-up:** Duration not extracted from accessible metadata.

**Safety/adverse events:** Tolerability was an endpoint, but specific adverse-event rates were not extracted.

**Limitations:** Pragmatic, product-specific, likely uncontrolled/subgroup evidence; not suitable for plain RYR efficacy estimates.
