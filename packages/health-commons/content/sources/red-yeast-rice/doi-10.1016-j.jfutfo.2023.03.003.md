---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1016-j.jfutfo.2023.03.003"
slug: "sources/red-yeast-rice/doi-10.1016-j.jfutfo.2023.03.003"
title: "The current trend and challenges of developing red yeast rice-based food supplements for hypercholesterolemia"
summary: "Review of RYR food supplements for hypercholesterolemia; summarizes human trials and development challenges including variable monacolin K, possible citrinin, combination products, and lack of equivalent-dose lovastatin controls."
status: "draft"
quality: "usable"
aliases:
  - "The current trend and challenges of developing red yeast rice-based food supplements for hypercholesterolemia"
  - "DOI 10.1016/j.jfutfo.2023.03.003"
categories:
  - "red-yeast-rice"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "journal_article"
  title: "The current trend and challenges of developing red yeast rice-based food supplements for hypercholesterolemia"
  authors: "Chen G; Chen W; Xu J; Ma G; Hu X; Chen G"
  year: 2023
  journal: "Journal of Future Foods"
  citation: "Chen G; Chen W; Xu J; Ma G; Hu X; Chen G. The current trend and challenges of developing red yeast rice-based food supplements for hypercholesterolemia. Journal of Future Foods. 2023;3(4):312-329. doi:10.1016/j.jfutfo.2023.03.003."
  url: "https://doi.org/10.1016/j.jfutfo.2023.03.003"
  doi: "10.1016/j.jfutfo.2023.03.003"
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.1016/j.jfutfo.2023.03.003"
    titleHash: "a52b39dd980536db53bf061c89859af9920bdf4ac9969eb1e4e99fadfa710e73"
    url: "https://doi.org/10.1016/j.jfutfo.2023.03.003"
  canonicalUrl: "https://doi.org/10.1016/j.jfutfo.2023.03.003"
researchEvidence:
  designKind: "narrative_review"
  designLabel: "Review of RYR food supplement development and challenges"
  populationLabel: "Human clinical trials of RYR food supplement products summarized by a review"
  durationLabel: "Human trials summarized ranged from 4 weeks to 60 months"
  aggregateRole: "context"
  cohortKey: "doi-10.1016-j.jfutfo.2023.03.003"
  notes:
    - "Participant count applies to the review/synthesis scope when reported; RYR-specific subset counts are preserved only when extracted."
    - "Directness: same_mechanism; claimUse: context-only."
evidenceBucket: "Evidence syntheses and reviews"
whyItMatters: "Helps define product-quality and formulation boundaries for a RYR cholesterol protocol."
potentialMurphEndpoints:
  - "product monacolin K content"
  - "citrinin contamination"
  - "LDL-C"
  - "total cholesterol"
protocolTakeaway: "Use for formulation and quality-control context only, not as a source for direct protocol effect estimates."
murphTakeaway: "Supports capturing product label details, monacolin K standardization, and citrinin/quality screening when available."
studyDesign: "review of RYR food supplement development and challenges"
modality: "Red yeast rice / monacolin K-containing nutraceutical"
directness: "same_mechanism"
claimUse: "context-only"
sourceFindings:
  -
    findingId: "finding:doi-10.1016-j.jfutfo.2023.03.003-human-trials-context"
    sourceKey: "source_artifact:doi-10.1016-j.jfutfo.2023.03.003"
    findingKind: "context"
    population: "Human clinical trials summarized in a food-supplement review"
    exposure: "RYR products alone or combined with coenzyme Q10, berberine, vitamins, plant extracts, phytosterols, polyunsaturated fatty acids, or probiotics"
    outcome: "Clinical-trial formulation and duration context"
    summary: "The review reports that RYR supplement trials ranged from 4 weeks to 60 months and used monacolin K contents from 0.32 mg/pack to 10 mg/pack; some combination ingredients may not have additive effects."
    evidenceUse:
      - "context"
      - "adjacent_variant"
  -
    findingId: "finding:doi-10.1016-j.jfutfo.2023.03.003-standardization-safety"
    sourceKey: "source_artifact:doi-10.1016-j.jfutfo.2023.03.003"
    findingKind: "safety"
    population: "RYR supplement products and trials summarized in the review"
    exposure: "Commercial or trial RYR preparations"
    outcome: "Product quality and safety limitations"
    summary: "Key limitations included variable monacolin K content, possible citrinin contamination, other bioactive compounds in preparations, and a lack of equivalent-dose lovastatin positive controls."
    evidenceUse:
      - "safety"
      - "context"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
---
This source is included for **Evidence syntheses and reviews**.

**Findings:**
- `finding:doi-10.1016-j.jfutfo.2023.03.003-human-trials-context` — The review reports that RYR supplement trials ranged from 4 weeks to 60 months and used monacolin K contents from 0.32 mg/pack to 10 mg/pack; some combination ingredients may not have additive effects.
- `finding:doi-10.1016-j.jfutfo.2023.03.003-standardization-safety` — Key limitations included variable monacolin K content, possible citrinin contamination, other bioactive compounds in preparations, and a lack of equivalent-dose lovastatin positive controls.

**Why it matters:** Helps define product-quality and formulation boundaries for a RYR cholesterol protocol.

**Potential experiment signals:** product monacolin K content, citrinin contamination, LDL-C, total cholesterol.

**Protocol takeaway:** Use for formulation and quality-control context only, not as a source for direct protocol effect estimates.

**Claim use:** `context-only`.

**Directness:** `same_mechanism`.

**Artifact rights status:** `open_access`. Copyrighted PDFs were not added; use metadata/manifest candidates unless redistribution rights are explicitly verified.
