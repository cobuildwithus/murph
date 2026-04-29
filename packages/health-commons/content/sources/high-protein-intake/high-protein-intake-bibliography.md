---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:high-protein-intake-bibliography
slug: sources/high-protein-intake/high-protein-intake-bibliography
title: "High-Protein Intake Bibliography"
summary: "Family bibliography record for the Protein Floor research package; detailed evidence remains in individual source pages and appraisal records."
status: draft
quality: usable
categories:
  - high-protein-intake
  - bibliography
  - protein-floor
relations:

  -
    type: related_protocol
    target: protocol_variant:high-protein-intake/protein-floor-high-protein-intake
  -
    type: parent_family
    target: experiment_family:high-protein-intake
sourceIdentity:
  identityKind: other
  canonicalIdBasis: title_hash
  identifiers:
    titleHash: 7424f14827698da7bde52690c3344cb1a21faade3887df0484a4b6510da25ae4
  identityAliases:
    - source_artifact:high-protein-intake-bibliography
source:
  kind: other
  title: "High-Protein Intake bibliography and source ledger"
researchEvidence:
  designKind: bibliography
  designLabel: "Protein Floor source ledger and bibliography"
  aggregateRole: context
  includedStudyCount: 334
  notes:
    - "Bibliography page created by the final landing reducer to satisfy the family/protocol bibliographyKey and cites relation."
---

This bibliography page anchors the High-Protein Intake family source key used by the family and protocol pages. The usable source corpus is materialized as individual source pages under `content/sources/high-protein-intake/`, with standalone source-to-protocol appraisal records in `content/evidence-appraisals/source-protocol-evidence/high-protein-intake.jsonl`.

No copyrighted PDFs or extracted full text are stored in Git. Artifact pointers are rights-safe metadata links in `content/artifacts/high-protein-intake/research-artifacts.json`.
