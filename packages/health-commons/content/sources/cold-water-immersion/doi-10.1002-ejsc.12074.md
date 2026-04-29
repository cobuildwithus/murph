---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1002-ejsc.12074
slug: sources/cold-water-immersion/doi-10.1002-ejsc.12074
title: 'Throwing cold water on muscle growth: A systematic review with meta-analysis of the effects of post-exercise cold water immersion on resistance training-induced hypertrophy'
summary: A recent hypertrophy-focused review/meta-analysis flags post-resistance-training CWI as a potential muscle-growth adaptation boundary.
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
  title: 'Throwing cold water on muscle growth: A systematic review with meta-analysis of the effects of post-exercise cold water immersion on resistance training-induced hypertrophy'
  authors: Piñero A; Burke R; Augustin F; Mohan AE; DeJesus K; Sapuppo M; Weisenthal M; Coleman M; Androulakis-Korakakis P; Grgic J; Swinton PA; Schoenfeld BJ
  year: 2024
  journal: European Journal of Sport Science
  doi: 10.1002/ejsc.12074
  url: https://doi.org/10.1002/ejsc.12074
  citation: 'Piñero A; Burke R; Augustin F; Mohan AE; DeJesus K; Sapuppo M; Weisenthal M; Coleman M; Androulakis-Korakakis P; Grgic J; Swinton PA; Schoenfeld BJ. Throwing cold water on muscle growth: A systematic review with meta-analysis of the effects of post-exercise cold water immersion on resistance training-induced hypertrophy. European Journal of Sport Science. 2024. doi:10.1002/ejsc.12074. PMCID: PMC11235606.'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    pmcid: PMC11235606
    doi: 10.1002/ejsc.12074
    titleHash: 2d2d54be390577704714df00cdf7a1aa25510c04469d6d067cc469ef1797ef06
    url: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11235606/
  canonicalUrl: https://doi.org/10.1002/ejsc.12074
  identityAliases:
  - DOI 10.1002/ejsc.12074
  - PMCID PMC11235606
  - 'Throwing cold water on muscle growth: A systematic review with meta-analysis of the effects of post-exercise cold water immersion on resistance training-induced hypertrophy'
researchEvidence:
  designKind: meta_analysis
  designLabel: Systematic review with meta-analysis of post-exercise CWI and resistance-training hypertrophy
  populationLabel: Resistance-training participants in hypertrophy studies
  durationLabel: Multi-week resistance-training interventions across included studies; exact durations vary by study
  cohortKey: cohort:doi-10-1002-ejsc-12074
  aggregateRole: primary
  notes:
  - 'Intervention/exposure: Post-exercise cold-water immersion during resistance training programs'
  - 'Comparator/control: Resistance training with non-cold or usual recovery comparators across included studies'
  - 'Endpoints: muscle hypertrophy; muscle growth; strength; resistance-training adaptation'
  - 'Effect direction: The review is targeted negative/boundary evidence: post-exercise CWI during resistance training was appraised for possible attenuation of hypertrophic adaptation.'
  - 'Safety/adverse-event notes: No acute adverse-event signal was extracted; the safety-relevant issue is possible interference with desired training adaptation.'
  - 'Limitations: Applies to post-lifting recovery, not standalone wellness plunging.; Included-study details and effect sizes were not fully extracted from accessible metadata.; Training status, dose timing, and hypertrophy measures may vary across included studies.'
  - 'Population/directness caveat: Resistance-training participants pursuing hypertrophy; not general health users.'
  - 'Directness to Cold Plunge: adjacent_variant'
  - 'Cold Plunge extraction context: bucket=Sports recovery and training-adaptation boundary; directness=adjacent_variant; claimUse=context-only; priority=medium'
sourceFindings:
- findingId: finding:doi-10-1002-ejsc-12074:hypertrophy-boundary
  sourceKey: source_artifact:doi-10.1002-ejsc.12074
  extractedFromArtifactId: art_doi_10_1002_ejsc_12074
  findingKind: intervention_result
  population: Resistance-training participants
  exposure: Post-exercise CWI during resistance training
  outcome: Resistance-training-induced hypertrophy
  summary: The review/meta-analysis specifically evaluates whether post-exercise CWI attenuates resistance-training-induced hypertrophy and should be treated as boundary evidence for muscle-growth claims.
  evidenceUse:
  - adjacent_variant
  - safety
- findingId: finding:doi-10-1002-ejsc-12074:timing-directness-limit
  sourceKey: source_artifact:doi-10.1002-ejsc.12074
  extractedFromArtifactId: art_doi_10_1002_ejsc_12074
  findingKind: context
  population: Resistance-training participants
  exposure: Cold exposure immediately after training
  outcome: Cold-plunge claim boundary
  summary: The source is adjacent to wellness cold plunging because it concerns recovery timing after lifting, not resting or standalone cold-plunge health outcomes.
  evidenceUse:
  - context
coldPlungeExtraction:
  batchId: batch-009
  evidenceBucket: Sports recovery and training-adaptation boundary
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  artifactRightsStatusGuess: open_access
  identityResolutionStatus: new_source
aliases:
- DOI 10.1002/ejsc.12074
- PMCID PMC11235606
- 'Throwing cold water on muscle growth: A systematic review with meta-analysis of the effects of post-exercise cold water immersion on resistance training-induced hypertrophy'
- 10.1002/ejsc.12074
- PMC11235606
---

This source is included for **Sports recovery and training-adaptation boundary**.

**Findings:** The review/meta-analysis specifically evaluates whether post-exercise CWI attenuates resistance-training-induced hypertrophy and should be treated as boundary evidence for muscle-growth claims.; The source is adjacent to wellness cold plunging because it concerns recovery timing after lifting, not resting or standalone cold-plunge health outcomes.

**Why it matters:** It is the most targeted source in this batch for avoiding claims that cold plunging after lifting always improves training outcomes.

**Potential experiment signals:** muscle hypertrophy; muscle growth; strength; resistance-training adaptation.

**Protocol takeaway:** Use as a boundary: avoid promoting immediate post-lifting cold plunges for users prioritizing hypertrophy unless the protocol is explicitly recovery-first and caveated.

**Claim use:** `context-only`.

**Population mismatch:** Resistance-training participants pursuing hypertrophy; not general health users.

**Limitations:** Applies to post-lifting recovery, not standalone wellness plunging.; Included-study details and effect sizes were not fully extracted from accessible metadata.; Training status, dose timing, and hypertrophy measures may vary across included studies.

**Artifact and rights note:** PDF rights status is `open_access`. This extraction creates a source-page draft and metadata/artifact candidate only; no copyrighted PDF is included in Git.
