---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1186-s12891-024-07315-2
slug: sources/cold-water-immersion/doi-10.1186-s12891-024-07315-2
title: The effects of hydrotherapy and cryotherapy on recovery from acute post-exercise induced muscle damage—a network meta-analysis
summary: Recent network meta-analysis suggests some adjacent post-exercise recovery signals for CWI, but comparator rankings and heterogeneity limit direct protocol use.
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
  title: The effects of hydrotherapy and cryotherapy on recovery from acute post-exercise induced muscle damage—a network meta-analysis
  authors: Chen R; Ma X; Ma X; Cui C
  year: 2024
  journal: BMC Musculoskeletal Disorders
  doi: 10.1186/s12891-024-07315-2
  url: https://doi.org/10.1186/s12891-024-07315-2
  citation: Chen R; Ma X; Ma X; Cui C. The effects of hydrotherapy and cryotherapy on recovery from acute post-exercise induced muscle damage—a network meta-analysis. BMC Musculoskeletal Disorders. 2024. doi:10.1186/s12891-024-07315-2.
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1186/s12891-024-07315-2
    titleHash: 5f2edafd2497a422b2937af9977cb3282fd7efa11668ea3da80a97d8ddfbcab2
    url: https://doi.org/10.1186/s12891-024-07315-2
  canonicalUrl: https://doi.org/10.1186/s12891-024-07315-2
  identityAliases:
  - DOI 10.1186/s12891-024-07315-2
  - The effects of hydrotherapy and cryotherapy on recovery from acute post-exercise induced muscle damage—a network meta-analysis
  - 'Effectiveness of different recovery strategies for muscle fatigue in adults: a systematic review and network meta-analysis'
researchEvidence:
  designKind: meta_analysis
  designLabel: Systematic review and network meta-analysis
  populationLabel: Healthy participants across 57 studies of acute post-exercise induced muscle damage
  durationLabel: Post-exercise recovery follow-up across included studies; exact durations vary by trial
  cohortKey: cohort:doi-10-1186-s12891-024-07315-2
  participantCount: 1220
  participantCountKind: reported
  aggregateRole: primary
  notes:
  - 'Intervention/exposure: Hydrotherapy and cryotherapy strategies including cold-water immersion, contrast-water therapy, warm/thermoneutral water, and cryotherapy'
  - 'Comparator/control: Control or alternative recovery modalities in included studies'
  - 'Endpoints: creatine kinase; delayed-onset muscle soreness; jump ability; exercise-induced muscle damage; functional recovery'
  - 'Effect direction: The network meta-analysis reported CWI versus control effects for CK, DOMS, and jump ability, while ranking CWT or cryotherapy highest for some outcomes.'
  - 'Safety/adverse-event notes: No source-level adverse-event signal was extracted from accessible metadata.'
  - 'Limitations: High heterogeneity by modality, protocol, and outcome timing.; Sex distribution was male-skewed in the included literature.; Network rankings should not be treated as direct cold-plunge prescriptions.'
  - 'Population/directness caveat: Healthy post-exercise muscle-damage literature, not wellness or clinical cold-plunge users.'
  - 'Directness to Cold Plunge: adjacent_variant'
  - 'Cold Plunge extraction context: bucket=Sports recovery and training-adaptation boundary; directness=adjacent_variant; claimUse=context-only; priority=medium'
sourceFindings:
- findingId: finding:doi-10-1186-s12891-024-07315-2:network-recovery-signal
  sourceKey: source_artifact:doi-10.1186-s12891-024-07315-2
  extractedFromArtifactId: art_doi_10_1186_s12891_024_07315_2
  findingKind: intervention_result
  population: Healthy participants with acute post-exercise induced muscle damage
  exposure: CWI and other hydrotherapy/cryotherapy recovery modalities
  outcome: Creatine kinase, DOMS, and jump ability
  summary: In 57 studies totaling 1220 participants, the network meta-analysis reported CWI versus control effects for CK, DOMS, and jump ability, suggesting adjacent recovery signals after exercise-induced muscle damage.
  evidenceUse:
  - adjacent_variant
  - efficacy
- findingId: finding:doi-10-1186-s12891-024-07315-2:ranking-and-heterogeneity
  sourceKey: source_artifact:doi-10.1186-s12891-024-07315-2
  extractedFromArtifactId: art_doi_10_1186_s12891_024_07315_2
  findingKind: context
  population: Healthy post-exercise recovery populations
  exposure: CWI, CWT, warm/thermoneutral water, and cryotherapy
  outcome: Comparator ranking and generalizability
  summary: CWT or cryotherapy ranked highest for some outcomes, and heterogeneous, male-skewed evidence limits direct transfer to cold-plunge wellness protocols.
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
- DOI 10.1186/s12891-024-07315-2
- The effects of hydrotherapy and cryotherapy on recovery from acute post-exercise induced muscle damage—a network meta-analysis
- 'Effectiveness of different recovery strategies for muscle fatigue in adults: a systematic review and network meta-analysis'
- 10.1186/s12891-024-07315-2
---

This source is included for **Sports recovery and training-adaptation boundary**.

**Findings:** In 57 studies totaling 1220 participants, the network meta-analysis reported CWI versus control effects for CK, DOMS, and jump ability, suggesting adjacent recovery signals after exercise-induced muscle damage.; CWT or cryotherapy ranked highest for some outcomes, and heterogeneous, male-skewed evidence limits direct transfer to cold-plunge wellness protocols.

**Why it matters:** It updates sports-recovery comparator context and preserves that CWI is not always the top-ranked recovery modality.

**Potential experiment signals:** creatine kinase; delayed-onset muscle soreness; jump ability; exercise-induced muscle damage; functional recovery.

**Protocol takeaway:** Use as adjacent sports-recovery context; avoid turning network rankings into general cold-plunge dose claims.

**Claim use:** `context-only`.

**Population mismatch:** Healthy post-exercise muscle-damage literature, not wellness or clinical cold-plunge users.

**Limitations:** High heterogeneity by modality, protocol, and outcome timing.; Sex distribution was male-skewed in the included literature.; Network rankings should not be treated as direct cold-plunge prescriptions.

**Artifact and rights note:** PDF rights status is `open_access`. This extraction creates a source-page draft and metadata/artifact candidate only; no copyrighted PDF is included in Git.
