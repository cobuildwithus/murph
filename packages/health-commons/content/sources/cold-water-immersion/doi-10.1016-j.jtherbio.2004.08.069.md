---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1016-j.jtherbio.2004.08.069
slug: sources/cold-water-immersion/doi-10.1016-j.jtherbio.2004.08.069
title: Adaptive changes in muscular performance and circulation by resistance training with regular cold application
summary: Older paywalled source retained as adaptation-boundary lineage, with no detailed effect claims extracted beyond metadata.
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
  kind: journal_article
  title: Adaptive changes in muscular performance and circulation by resistance training with regular cold application
  authors: Ohnishi N; Yamane M; Uchiyama N; Shirasawa S; Kosaka M; Shiono H; Okada T
  year: 2004
  journal: Journal of Thermal Biology
  doi: 10.1016/j.jtherbio.2004.08.069
  url: https://doi.org/10.1016/j.jtherbio.2004.08.069
  citation: Ohnishi N; Yamane M; Uchiyama N; Shirasawa S; Kosaka M; Shiono H; Okada T. Adaptive changes in muscular performance and circulation by resistance training with regular cold application. Journal of Thermal Biology. 2004. doi:10.1016/j.jtherbio.2004.08.069.
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1016/j.jtherbio.2004.08.069
    titleHash: 4860997be370bf1a8ee0093720ea46e6a84ff86d769eb4edad60fea63682914a
    url: https://doi.org/10.1016/j.jtherbio.2004.08.069
  canonicalUrl: https://doi.org/10.1016/j.jtherbio.2004.08.069
  identityAliases:
  - DOI 10.1016/j.jtherbio.2004.08.069
  - Adaptive changes in muscular performance and circulation by resistance training with regular cold application
researchEvidence:
  designKind: acute_mechanistic
  designLabel: Older resistance-training plus regular cold-application physiology study
  populationLabel: Resistance-training participants exposed to regular cold application
  durationLabel: Training duration not confirmed from accessible source metadata
  cohortKey: cohort:doi-10-1016-j-jtherbio-2004-08-069
  aggregateRole: primary
  notes:
  - 'Intervention/exposure: Regular cold application combined with resistance training'
  - 'Comparator/control: Resistance training without regular cold application, according to source-lineage metadata'
  - 'Endpoints: muscular performance; circulation; training adaptation'
  - 'Effect direction: Accessible metadata identifies this as an older precursor on muscular-performance and circulation adaptation with regular cold application; detailed results were not extracted.'
  - 'Safety/adverse-event notes: No adverse-event information was extracted from accessible metadata.'
  - 'Limitations: Paywalled older source with limited accessible extraction.; Cold application and resistance-training context may differ from full-body cold plunging.; Detailed sample size and effect estimates were not available in accessible metadata.'
  - 'Population/directness caveat: Training adaptation context, not general wellness cold plunging.'
  - 'Directness to Cold Plunge: adjacent_variant'
  - 'Cold Plunge extraction context: bucket=Sports recovery and training-adaptation boundary; directness=adjacent_variant; claimUse=context-only; priority=medium'
sourceFindings:
- findingId: finding:doi-10-1016-j-jtherbio-2004-08-069:adaptation-lineage
  sourceKey: source_artifact:doi-10.1016-j.jtherbio.2004.08.069
  extractedFromArtifactId: art_doi_10_1016_j_jtherbio_2004_08_069
  findingKind: context
  population: Resistance-training participants
  exposure: Regular cold application with training
  outcome: Muscular performance and circulation adaptation
  summary: The source is an older Journal of Thermal Biology article on resistance training with regular cold application and is retained as lineage for adaptation-boundary evidence; detailed effects were not extracted from accessible metadata.
  evidenceUse:
  - context
- findingId: finding:doi-10-1016-j-jtherbio-2004-08-069:paywalled-detail-limit
  sourceKey: source_artifact:doi-10.1016-j.jtherbio.2004.08.069
  extractedFromArtifactId: art_doi_10_1016_j_jtherbio_2004_08_069
  findingKind: context
  population: Not reported in accessible extract
  exposure: Paywalled source
  outcome: Evidence extraction boundary
  summary: Because sample size and effect estimates were not accessible, this source should not carry standalone protocol claims without full-text verification.
  evidenceUse:
  - context
coldPlungeExtraction:
  batchId: batch-009
  evidenceBucket: Sports recovery and training-adaptation boundary
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  artifactRightsStatusGuess: paywalled
  identityResolutionStatus: new_source
aliases:
- DOI 10.1016/j.jtherbio.2004.08.069
- Adaptive changes in muscular performance and circulation by resistance training with regular cold application
- 10.1016/j.jtherbio.2004.08.069
---

This source is included for **Sports recovery and training-adaptation boundary**.

**Findings:** The source is an older Journal of Thermal Biology article on resistance training with regular cold application and is retained as lineage for adaptation-boundary evidence; detailed effects were not extracted from accessible metadata.; Because sample size and effect estimates were not accessible, this source should not carry standalone protocol claims without full-text verification.

**Why it matters:** It helps trace the research lineage behind later Yamane adaptation-interference studies without overclaiming inaccessible details.

**Potential experiment signals:** muscular performance; circulation; training adaptation.

**Protocol takeaway:** Use only as background lineage for training-adaptation boundary; do not use for protocol efficacy claims.

**Claim use:** `context-only`.

**Population mismatch:** Training adaptation context, not general wellness cold plunging.

**Limitations:** Paywalled older source with limited accessible extraction.; Cold application and resistance-training context may differ from full-body cold plunging.; Detailed sample size and effect estimates were not available in accessible metadata.

**Artifact and rights note:** PDF rights status is `paywalled`. This extraction creates a source-page draft and metadata/artifact candidate only; no copyrighted PDF is included in Git.
