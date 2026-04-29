---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1111-j.1365-277x.1994.tb00423.x"
slug: "sources/psyllium-husk/doi-10.1111-j.1365-277x.1994.tb00423.x"
title: "The effects of psyllium on blood lipids in hypercholesterolaemic subjects"
summary: "Small double-blind trial found within-group lipid reductions with psyllium cereal but no significant between-group lipid differences versus control cereal."
status: "draft"
quality: "usable"
aliases:
  - "doi-10.1111-j.1365-277x.1994.tb00423.x"
  - "10.1111/j.1365-277x.1994.tb00423.x"
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
  kind: "journal_article"
  title: "The effects of psyllium on blood lipids in hypercholesterolaemic subjects"
  authors: "C. D. Summerbell, P. Manley, D. Barnes, A. Leeds"
  year: 1994
  journal: "Journal of Human Nutrition and Dietetics"
  citation: "Summerbell CD, Manley P, Barnes D, Leeds A. The effects of psyllium on blood lipids in hypercholesterolaemic subjects. Journal of Human Nutrition and Dietetics. 1994;7(2):147-151. doi:10.1111/j.1365-277X.1994.tb00423.x"
  doi: "10.1111/j.1365-277x.1994.tb00423.x"
  url: "https://doi.org/10.1111/j.1365-277X.1994.tb00423.x"
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.1111/j.1365-277x.1994.tb00423.x"
    url: "https://doi.org/10.1111/j.1365-277X.1994.tb00423.x"
  canonicalUrl: "https://doi.org/10.1111/j.1365-277X.1994.tb00423.x"
  identityAliases:
    - "doi-10.1111-j.1365-277x.1994.tb00423.x"
    - "10.1111/j.1365-277x.1994.tb00423.x"
researchEvidence:
  designKind: "randomized_controlled_trial"
  designLabel: "Small double-blind placebo-controlled trial of psyllium-containing cereal after low-fat diet phase"
  participantCount: 37
  participantCountKind: "reported"
  populationLabel: "Adults with mild-to-moderate hypercholesterolemia, total cholesterol 5.2 to 7.8 mmol/L."
  durationLabel: "3-week low-fat diet phase followed by 6-week randomized cereal phase."
  aggregateRole: "primary"
  cohortKey: "psyllium-cereal-hypercholesterolaemic-small-rct-1994"
  notes:
    - "Batch batch-001: Candidate from 03-discovery-direct-rct-hypercholesterolemia. Discovery rationale: Small double-blind trial with reported non-significant between-group differences; important null/mixed evidence."
    - "Artifact extraction source: art_doi_10_1111_j_1365_277x_1994_tb00423_x_html."
evidenceBucket: "Direct protocol adult lipid trial evidence"
whyItMatters: "This is an important null/mixed direct trial that prevents overclaiming from positive studies alone."
potentialMurphEndpoints:
  - "LDL-C"
  - "total cholesterol"
  - "HDL-C"
  - "body weight"
protocolTakeaway: "Do not imply every psyllium cereal trial proves superiority; this small study did not find significant between-group differences."
murphTakeaway: "The protocol should be tested with pre/post labs and realistic expectations, not assumed to work for every user."
studyDesign: "Double-blind placebo-controlled randomized trial"
modality: "High-fiber cereal with 9.6 g soluble fiber from psyllium versus high-fiber cereal with negligible soluble fiber, both on low-fat diet."
directness: "direct_protocol"
claimUse: "context-only"
populationMismatch: "Low mismatch for mild-to-moderate hypercholesterolemia, but cereal delivery and small sample limit applicability to loose husk protocols."
limitations:
  - "Small sample size."
  - "Both groups continued low-fat diet and high-fiber cereal, reducing contrast."
  - "Between-group differences in TC, LDL-C, and HDL-C were not significant."
safetyNotes: "Accessible extraction did not identify adverse-event details."
sourceFindings:

  -
    findingId: "finding:doi-10.1111-j.1365-277x.1994.tb00423.x-non-significant-between-group"
    sourceKey: "source_artifact:doi-10.1111-j.1365-277x.1994.tb00423.x"
    extractedFromArtifactId: "art_doi_10_1111_j_1365_277x_1994_tb00423_x_html"
    findingKind: "intervention_result"
    population: "37 adults with mild-to-moderate hypercholesterolemia after a 3-week low-fat diet phase."
    exposure: "60 g/day cereal containing 9.6 g soluble fiber from psyllium versus control high-fiber cereal for 6 weeks."
    outcome: "Total cholesterol, LDL-C, HDL-C, and body weight."
    summary: "The psyllium group had within-group reductions in total cholesterol and LDL-C, but between-group differences in total cholesterol, LDL-C, and HDL-C were not statistically significant versus control."
    evidenceUse:
      - "context"
murphV1Priority: "Medium"
pdfRightsStatus: "paywalled"
---
This source is included for **Direct protocol adult lipid trial evidence**.

## Source extraction notes

**Findings:** The psyllium group had within-group reductions in total cholesterol and LDL-C, but between-group differences in total cholesterol, LDL-C, and HDL-C were not statistically significant versus control.

**Why it matters:** This is an important null/mixed direct trial that prevents overclaiming from positive studies alone.

**Potential experiment signals:** LDL-C; total cholesterol; HDL-C; body weight.

**Protocol takeaway:** Do not imply every psyllium cereal trial proves superiority; this small study did not find significant between-group differences.

**Claim use:** `context-only`.

## Evidence boundary

- **Directness:** `direct_protocol`.
- **Population mismatch:** Low mismatch for mild-to-moderate hypercholesterolemia, but cereal delivery and small sample limit applicability to loose husk protocols.
- **Limitations:** Small sample size. Both groups continued low-fat diet and high-fiber cereal, reducing contrast. Between-group differences in TC, LDL-C, and HDL-C were not significant.
- **Safety notes:** Accessible extraction did not identify adverse-event details.
- **Artifact rights:** `paywalled`; candidate artifact `art_doi_10_1111_j_1365_277x_1994_tb00423_x_html` is metadata/link-only unless rights review clears redistribution.
