---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1002-lim2.70009
slug: sources/cold-water-immersion/doi-10.1002-lim2.70009
title: 'Cold Water Swimming and Pregnancy: A Scoping Review and Consensus Recommendations'
summary: Pregnancy-specific scoping review and consensus statement for cold-water swimming with limited direct evidence.
status: draft
quality: usable
categories:
- cold-water-immersion
- cold-plunge
relations:
- type: parent_family
  target: experiment_family:cold-water-immersion
- type: related_protocol
  target: protocol_variant:cold-water-immersion/cold-plunge
source:
  kind: review
  title: 'Cold Water Swimming and Pregnancy: A Scoping Review and Consensus Recommendations'
  authors: Jill Shawe; Malika Felton; Joyce C. Harper; C. Mark Harper; R. Stidson; Michael Tipton; S. Blowers; K. Fraser; S. Hingley; E. McGrath; G. Bainbridge; Heather Massey
  year: 2025
  journal: Lifestyle Medicine
  doi: 10.1002/lim2.70009
  url: https://doi.org/10.1002/lim2.70009
  citation: 'Jill Shawe; Malika Felton; Joyce C. Harper; C. Mark Harper; R. Stidson; Michael Tipton; S. Blowers; K. Fraser; S. Hingley; E. McGrath; G. Bainbridge; Heather Massey. Cold Water Swimming and Pregnancy: A Scoping Review and Consensus Recommendations. Lifestyle Medicine. 2025. doi:10.1002/lim2.70009'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1002/lim2.70009
    titleHash: c97c9b345b78c573a35875e2fbb7ccec69e7756552543e92f2c0e71a7f9860ee
    url: https://doi.org/10.1002/lim2.70009
  canonicalUrl: https://doi.org/10.1002/lim2.70009
  identityAliases:
  - doi:10.1002/lim2.70009
  - Jill Shawe 2025
  - 'Cold Water Swimming and Pregnancy: A Scoping Review and Consensus Recommendations'
researchEvidence:
  designKind: systematic_review
  designLabel: Scoping review and consensus recommendations
  populationLabel: Pregnant people considering outdoor cold-water swimming
  durationLabel: Scoping review of limited pregnancy evidence plus consensus recommendations
  cohortKey: cohort:doi-10.1002-lim2.70009
  includedStudyCount: 4
  aggregateRole: synthesis
  notes:
  - Generated source-index.json was absent from the supplied snapshot; resolved against canonical ledger and local candidate records only.
  - 'Canonical ledger note: Candidate shards: 09-discovery-safety-adverse-events; raw candidate rows merged: 1. Candidate IDs: candidate:safety-adverse-events:035. Generated source-index.json was absent from supplied snapshot; no existing cold-water source inventory was available, so this is a provisional new-source resolution pending generated-index check. Safety-only: use for screens, stop rules, contraindications, or adverse-event context, not benefit claims.'
  - 'Cold Plunge extraction context: bucket=Safety, adverse events, and cold-shock boundaries; directness=same_mechanism; claimUse=safety-only; priority=high'
sourceFindings:
- findingId: finding:doi-10.1002-lim2.70009:pregnancy-consensus-boundary
  sourceKey: source_artifact:doi-10.1002-lim2.70009
  extractedFromArtifactId: art_doi_10_1002_lim2_70009
  findingKind: safety
  population: Pregnant people considering outdoor cold-water swimming
  exposure: Cold-water swimming during pregnancy
  outcome: pregnancy safety; blood pressure; cold shock; drowning risk; expert recommendations
  summary: This scoping review and consensus recommendation found very limited pregnancy-specific cold-water swimming evidence, with recommendations largely dependent on expert opinion. Pregnancy should therefore be treated as a conservative safety boundary for cold plunging.
  evidenceUse:
  - safety
  - context
coldPlungeExtraction:
  batchId: batch-005
  evidenceBucket: Safety, adverse events, and cold-shock boundaries
  directness: same_mechanism
  claimUse: safety-only
  priority: high
  artifactRightsStatusGuess: open_access
  identityResolutionStatus: new_source
aliases:
- doi:10.1002/lim2.70009
- Jill Shawe 2025
- 'Cold Water Swimming and Pregnancy: A Scoping Review and Consensus Recommendations'
- 10.1002/lim2.70009
---

This source is included for **Safety, adverse events, and cold-shock boundaries**.

**Findings:** This scoping review and consensus recommendation found very limited pregnancy-specific cold-water swimming evidence, with recommendations largely dependent on expert opinion. Pregnancy should therefore be treated as a conservative safety boundary for cold plunging.

**Why it matters:** Pregnancy-specific evidence is sparse; the safest protocol boundary is to avoid routine claims and recommend medical guidance.

**Potential experiment signals:** pregnancy status, blood pressure symptoms, cold-shock symptoms, dizziness/syncope, drowning risk.

**Protocol takeaway:** Use only for pregnancy safety screening and medical-clearance language, not protocol efficacy.

**Claim use:** `safety-only`.

## Extraction notes

- Directness to Cold Plunge: `same_mechanism`.
- Population mismatch: Pregnant cold-water swimmers are a specific population that should not be generalized to all users or treated as low risk.
- Limitations: Only a small number of studies were available.; Consensus recommendations were largely lower-grade expert opinion.; Outdoor swimming is adjacent to but not identical with controlled tub plunges.
- Artifact rights: `open_access`. No copyrighted PDF is included in Git; this draft records metadata and candidate artifact information only.
