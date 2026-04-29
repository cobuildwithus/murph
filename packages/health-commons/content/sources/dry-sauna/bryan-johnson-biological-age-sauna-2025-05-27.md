---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:bryan-johnson-biological-age-sauna-2025-05-27
slug: sources/dry-sauna/bryan-johnson-biological-age-sauna-2025-05-27
title: Can sauna reduce biological age?
summary: Blueprint article documenting baseline vascular/biological-age measurements before Johnson tested sauna; it is context for measurement selection and does not report a sauna effect.
status: draft
quality: usable
aliases:
- Can sauna reduce biological age?
- Bryan Johnson sauna biological age baseline
categories:
- dry-sauna
- bryan-johnson-blueprint
relations:
- type: related_protocol
  target: protocol_variant:dry-sauna/bryan-johnson-blueprint
- type: parent_family
  target: experiment_family:dry-sauna
source:
  kind: web_page
  title: Can sauna reduce biological age?
  authors: Bryan Johnson
  year: 2025
  journal: Blueprint Bryan Johnson
  citation: Johnson B. Can sauna reduce biological age? Blueprint Bryan Johnson. Published May 27, 2025.
  url: https://blueprint.bryanjohnson.com/blogs/news/can-sauna-reduce-biological-age
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: e93af42941d606ab478e88e0da5423e032c5996e17e11f64bd53cfdb2dc0c449
    url: https://blueprint.bryanjohnson.com/blogs/news/can-sauna-reduce-biological-age
  canonicalUrl: https://blueprint.bryanjohnson.com/blogs/news/can-sauna-reduce-biological-age
researchEvidence:
  designKind: single_person_report
  designLabel: Single-person baseline measurement note
  populationLabel: Bryan Johnson; adult male self-tracker, age 48 in source
  durationLabel: Pre-protocol baseline only
  aggregateRole: primary
  cohortKey: bryan-johnson-biological-age-sauna-2025-05-27
  participantCount: 1
  participantCountKind: reported
evidenceBucket: Direct external-protocol provenance and self-experiment claims
whyItMatters: Prevents later synthesis from treating baseline vascular numbers as post-sauna results.
potentialMurphEndpoints:
- morning blood pressure
- vascular-age context
- central-pressure context
protocolTakeaway: Use only as baseline measurement context.
murphTakeaway: A useful measurement-provenance source, not evidence that sauna reduced biological age.
studyDesign: N=1 baseline measurement context
modality: Pre-sauna measurement context
claimUse: context-only
sourceFindings:
- findingId: finding:bryan-johnson-biological-age-sauna-2025-05-27-baseline
  sourceKey: source_artifact:bryan-johnson-biological-age-sauna-2025-05-27
  extractedFromArtifactId: art_bryan_johnson_biological_age_sauna_2025_05_27_web
  findingKind: context
  population: Bryan Johnson; adult male self-tracker, age 48 as stated in the source.
  exposure: Pre-sauna baseline vascular measurements before testing whether sauna would improve vascular/biological-age signals.
  outcome: Baseline only; no sauna intervention result in this source.
  summary: The source says Johnson planned to test sauna and recorded baseline vascular measures before the protocol, including vascular age 30, central systolic BP 103 mmHg, central pulse pressure 28 mmHg, pulse pressure amplification 145%, SEVR 220%, augmentation pressure 2 mmHg, augmentation index 8%, and brachial BP 115/74 mmHg.
  evidenceUse:
  - context
murphV1Priority: Medium
pdfRightsStatus: unknown
sourceIndexResolution:
  sourceIndexStatus: absent_from_uploaded_repo_snapshot
  identityResolutionStatus: new_source
  canonicalSourceKey: null
  ledgerNotes: 'Generated source-index.json was absent from repo.snapshot; resolved against available source pages/artifact manifests and candidate identities only. Candidate shards: 02-discovery-direct-external-protocol.'
---

This source is included for **Direct external-protocol provenance and self-experiment claims**.

**Findings:** It records baseline vascular measurements before Johnson tested sauna.

**Why it matters:** It distinguishes baseline measurement context from post-intervention outcome claims.

**Potential experiment signals:** blood pressure, vascular-age proxies, and measurement repeatability.

**Protocol takeaway:** Do not use this source as evidence that sauna changed any endpoint.

**Claim use:** `context-only`.
