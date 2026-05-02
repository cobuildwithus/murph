---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1016-j.metabol.2014.02.007
slug: sources/high-protein-intake/doi-10.1016-j.metabol.2014.02.007
title: "High protein diets do not attenuate decrements in testosterone and IGF-I during energy deficit"
summary: "Protein Floor source ledger record (safety-only; measurement_context)."
status: draft
quality: usable
categories:
  - high-protein-intake
  - protein-floor
  - safety_boundaries_labs
relations:

  -
    type: related_protocol
    target: protocol_variant:high-protein-intake/protein-floor-high-protein-intake
  -
    type: parent_family
    target: experiment_family:high-protein-intake
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1016/j.metabol.2014.02.007
    url: https://www.sciencedirect.com/science/article/pii/S0026049514000548/
  identityAliases:
    - source_artifact:doi-10.1016-j.metabol.2014.02.007
    - 10.1016/j.metabol.2014.02.007
  canonicalUrl: https://www.sciencedirect.com/science/article/pii/S0026049514000548/
source:
  kind: journal_article
  title: "High protein diets do not attenuate decrements in testosterone and IGF-I during energy deficit"
  authors: Paul C. Henning; Lee M. Margolis; James P. McClung; Andrew J. Young et al.
  journal: Metabolism
  doi: 10.1016/j.metabol.2014.02.007
  url: https://www.sciencedirect.com/science/article/pii/S0026049514000548/
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: rct
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-013; priority: medium; claimUse: safety-only; directness: measurement_context"
sourceFindings:

  -
    findingId: finding:doi-10-1016-j-metabol-2014-02-007-hormone-decrements-not-attenuated
    sourceKey: source_artifact:doi-10.1016-j.metabol.2014.02.007
    extractedFromArtifactId: art_doi_10_1016_j_metabol_2014_02_007
    findingKind: mechanistic
    population: "33 adults assigned to 0.8, 1.6, or 2.4 g/kg/day protein during a controlled feeding study."
    exposure: "Higher-protein diets during weight maintenance and 40% energy deficit."
    outcome: "Total testosterone, free testosterone, IGF-I, SHBG, and IGF-binding proteins."
    summary: "During energy deficit, total/free testosterone, total IGF-I, and acid-labile subunit decreased while SHBG and IGF-binding proteins increased, with no energy-by-protein interaction on measured hormones."
    evidenceUse:
      - mechanism
      - safety
  -
    findingId: finding:doi-10-1016-j-metabol-2014-02-007-ffm-mechanism-boundary
    sourceKey: source_artifact:doi-10.1016-j.metabol.2014.02.007
    extractedFromArtifactId: art_doi_10_1016_j_metabol_2014_02_007
    findingKind: mechanistic
    population: "Adults undergoing short-term controlled energy deficit."
    exposure: "Protein intakes above the RDA, including 1.6 and 2.4 g/kg/day."
    outcome: "Relationship between anabolic hormones and fat-free-mass protection."
    summary: "The authors concluded that any fat-free-mass protective effect of higher protein during energy deficit was not likely mediated by systemic anabolic hormone concentrations."
    evidenceUse:
      - mechanism
evidenceBucket: safety_boundaries_labs
protocolTakeaway: "Use to temper endocrine claims and to place FFM effects in a mechanism boundary rather than a hormone-preservation promise."
claimUse: safety-only
directness: measurement_context
murphV1Priority: medium
aliases:
  - doi-10.1016-j.metabol.2014.02.007
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** safety-only (measurement_context).
- **Evidence bucket:** safety_boundaries_labs.
- **Extraction batch:** batch-013.

## Artifact pointer

- **art_doi_10_1016_j_metabol_2014_02_007** — external html pointer; rights: permission_required; redistributable: False

## Extracted findings

- **finding:doi-10-1016-j-metabol-2014-02-007-hormone-decrements-not-attenuated** — During energy deficit, total/free testosterone, total IGF-I, and acid-labile subunit decreased while SHBG and IGF-binding proteins increased, with no energy-by-protein interaction on measured hormones.
- **finding:doi-10-1016-j-metabol-2014-02-007-ffm-mechanism-boundary** — The authors concluded that any fat-free-mass protective effect of higher protein during energy deficit was not likely mediated by systemic anabolic hormone concentrations.

## Protocol appraisal

- **evidence_appraisal:protein-floor-high-protein-intake:doi-10.1016-j.metabol.2014.02.007** — High protein did not preserve testosterone or IGF-I during short-term energy deficit. Implication: Use to temper endocrine claims and to place FFM effects in a mechanism boundary rather than a hormone-preservation promise.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
