---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:daily-step-floor-bibliography
slug: sources/daily-step-floor/daily-step-floor-bibliography
title: Daily Step Floor bibliography and source-ledger synthesis
summary: Curated Daily Step Floor source ledger, extraction-coverage note, and rights-safety index for the protocol package.
status: draft
quality: usable
aliases:
- daily-step-floor bibliography
- daily-step-floor source ledger
categories:
- daily-step-floor
- bibliography
- research-governance
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: other
  title: Daily Step Floor bibliography and source-ledger synthesis
  year: 2026
  citation: Murph Health Commons. Daily Step Floor bibliography and source-ledger synthesis. 2026-04-28 research package draft.
sourceIdentity:
  identityKind: other
  canonicalIdBasis: title_hash
  identifiers:
    titleHash: 89c2bc6e761999a150c4f51cfa4ce45cd2de4ad01298eca450a0eaf0b716e458
  identityAliases:
  - Daily Step Floor research package 2026-04-28
researchEvidence:
  designKind: bibliography
  designLabel: Canonical source ledger reducer plus extracted source-page and appraisal outputs
  aggregateRole: synthesis
  notes:
  - 'Canonical ledger source records: 334.'
  - 'Extracted source-page drafts recovered: 320 unique source keys.'
  - 'Metadata-only stubs generated: 14 source keys.'
  - Generated source-index.json was absent from the supplied snapshot, so duplicate-source reuse was checked against the existing content tree and canonical ledger only.
  - Copyrighted PDFs and binaries are not committed; artifacts are rights-safe manifest candidates only.
sourceFindings:
- findingId: finding:daily-step-floor-bibliography-source-coverage
  sourceKey: source_artifact:daily-step-floor-bibliography
  findingKind: context
  population: Daily Step Floor research corpus.
  outcome: Source coverage and governance
  summary: Canonical ledger contains 334 records; 320 had extracted source-page drafts; 14 were preserved as metadata-only stubs because batch 012 extraction artifacts were missing in the snapshot.
  evidenceUse:
  - context
---

This bibliography page is a Health Commons research-governance artifact for **Daily Step Floor**. It is not a primary efficacy source.

## Corpus snapshot

- Canonical ledger records: **334**
- Extracted source-page drafts recovered: **320**
- Metadata-only stubs generated from the ledger: **14**
- Source kind counts: `{"guideline": 20, "implementation_checklist": 1, "journal_article": 226, "other": 1, "review": 80, "trial_registry": 4, "web_page": 2}`
- Evidence-directness counts: `{"adjacent_variant": 106, "clinical_supervised": 33, "direct_protocol": 70, "general_guideline": 34, "measurement_context": 59, "same_mechanism": 32}`
- Claim-use counts: `{"context-only": 228, "safety-only": 39, "supports-protocol": 67}`
- Priority counts: `{"backbone": 31, "high": 119, "low": 3, "medium": 181}`

## Governance note

The package keeps direct protocol evidence, adjacent variants, measurement context, general guidelines, safety-only sources, and observational context separate. It does not treat every step-count paper as proof that a Daily Step Floor improves health outcomes.

Generated `packages/health-commons/generated/source-index.json` was absent from the supplied snapshot. Duplicate-source reuse therefore used the canonical source ledger and the existing content tree only.

## Rights note

No copyrighted PDFs or full-text binaries are placed in Git. The artifact manifest uses metadata/link candidates with redistributable set to false unless a future rights review explicitly approves staging and storage.
