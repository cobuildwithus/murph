---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1002-lim2.53
slug: sources/cold-water-immersion/doi-10.1002-lim2.53
title: Improved mood following a single immersion in cold water
summary: The CWI group reduced total mood disturbance by 15 points versus 2 points in controls; positive subscales increased and negative subscales decreased in the immersion group.
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
  title: Improved mood following a single immersion in cold water
  authors: Kelly JS; Bird EL
  year: 2022
  journal: Lifestyle Medicine
  doi: 10.1002/lim2.53
  url: https://doi.org/10.1002/lim2.53
  citation: Kelly JS; Bird EL. Improved mood following a single immersion in cold water. Lifestyle Medicine. 2022. doi:10.1002/lim2.53.
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1002/lim2.53
    titleHash: d6e5f6d2fef94b6c037541c4d8cc1990c2b147e3589589a393b8e78d6d4aaee5
    url: https://doi.org/10.1002/lim2.53
  canonicalUrl: https://doi.org/10.1002/lim2.53
  identityAliases:
  - DOI 10.1002/lim2.53
  - Improved mood following a single immersion in cold water
researchEvidence:
  designKind: controlled_trial
  designLabel: Single-session controlled mood study
  populationLabel: Undergraduate students; young, fit, and healthy participants.
  durationLabel: Single immersion with immediate post-immersion Profile of Mood States measurement.
  cohortKey: cohort:doi-10.1002-lim2.53
  participantCount: 64
  participantCountKind: reported
  aggregateRole: primary
  notes:
  - 'Intervention/exposure: Up to 20 minutes in cold seawater at 13.6 °C; mean exposure approximately 18 minutes 36 seconds.'
  - 'Comparator/control: Non-immersed control group completed the same mood questionnaire schedule.'
  - 'Endpoints: total mood disturbance; vigour; esteem-related affect; tension; anger; depression; fatigue; confusion'
  - 'Effect direction: The CWI group reduced total mood disturbance by 15 points versus 2 points in controls; positive subscales increased and negative subscales decreased in the immersion group.'
  - 'Safety/adverse-event notes: Authors noted cold-shock risks including arrhythmia and involuntary gasp/aspiration; intervention was framed as tolerated in young, fit, healthy participants.'
  - 'Limitations: Natural seawater setting can introduce nature, outdoor, and social-context confounding.; Young healthy undergraduate sample.; Single-session mood outcome only.'
  - 'Population/directness caveat: Young fit healthy students; not general clinical or higher-risk populations.'
  - 'Directness to Cold Plunge: direct_protocol'
  - 'Cold Plunge extraction context: bucket=Direct cold-plunge intervention evidence; directness=direct_protocol; claimUse=supports-protocol; priority=high'
sourceFindings:
- findingId: finding:doi-10.1002-lim2.53:mood-improvement
  sourceKey: source_artifact:doi-10.1002-lim2.53
  extractedFromArtifactId: art_doi_10_1002_lim2_53
  findingKind: intervention_result
  population: Young fit healthy undergraduate students
  exposure: Single cold seawater immersion at 13.6 °C for up to 20 minutes
  outcome: Profile of Mood States mood score
  summary: The CWI group had a 15-point total mood disturbance reduction versus a 2-point control reduction, with improvements across positive and negative mood subscales.
  evidenceUse:
  - efficacy
- findingId: finding:doi-10.1002-lim2.53:cold-shock-caution
  sourceKey: source_artifact:doi-10.1002-lim2.53
  extractedFromArtifactId: art_doi_10_1002_lim2_53
  findingKind: safety
  population: Young fit healthy undergraduate students
  exposure: Single cold-water immersion
  outcome: Cold-shock safety boundary
  summary: The authors cautioned that cold-water immersion carries cold-shock risks including arrhythmia and involuntary gasp/aspiration, so mood findings should not be generalized to unscreened or unsupervised users.
  evidenceUse:
  - safety
coldPlungeExtraction:
  batchId: batch-001
  evidenceBucket: Direct cold-plunge intervention evidence
  directness: direct_protocol
  claimUse: supports-protocol
  priority: high
  artifactRightsStatusGuess: open_access
  identityResolutionStatus: new_source
aliases:
- DOI 10.1002/lim2.53
- Improved mood following a single immersion in cold water
- 10.1002/lim2.53
---

This source is included for **Direct cold-plunge intervention evidence**.

**Findings:** The CWI group had a 15-point total mood disturbance reduction versus a 2-point control reduction, with improvements across positive and negative mood subscales. The authors cautioned that cold-water immersion carries cold-shock risks including arrhythmia and involuntary gasp/aspiration, so mood findings should not be generalized to unscreened or unsupervised users.

**Why it matters:** Direct immersion source for acute mood, while explicitly warning that setting and safety matter.

**Potential experiment signals:** total mood disturbance; vigour; esteem-related affect; tension; anger; depression; fatigue; confusion.

**Protocol takeaway:** Supports acute mood signal in a screened young healthy population, with confounding and cold-shock caveats.

**Claim use:** `supports-protocol`.

**Population mismatch:** Young fit healthy students; not general clinical or higher-risk populations.

**Limitations:** Natural seawater setting can introduce nature, outdoor, and social-context confounding.; Young healthy undergraduate sample.; Single-session mood outcome only.

**Artifact and rights note:** Metadata and source page draft only. PDF rights status is `open_access`; do not place copyrighted PDFs in Git unless rights are clearly open and redistributable.
