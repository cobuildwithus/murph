---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1002-lim2.70044
slug: sources/cold-water-immersion/doi-10.1002-lim2.70044
title: 'The Influence of Immersion Environment on Mood: Comparing Sea Versus Laboratory Cold Exposure'
summary: Mood improved after both immersions; sea immersion produced a modestly greater reduction in total mood disturbance and larger increase in esteem-related affect than laboratory immersion.
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
  title: 'The Influence of Immersion Environment on Mood: Comparing Sea Versus Laboratory Cold Exposure'
  authors: Kelly JS
  year: 2025
  journal: Lifestyle Medicine
  doi: 10.1002/lim2.70044
  url: https://doi.org/10.1002/lim2.70044
  citation: 'Kelly JS. The Influence of Immersion Environment on Mood: Comparing Sea Versus Laboratory Cold Exposure. Lifestyle Medicine. 2025. doi:10.1002/lim2.70044.'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1002/lim2.70044
    titleHash: 6b11a8015e2451f562a843374ddaf6aa84ca05870cac301104e833ccc8cb56b2
    url: https://doi.org/10.1002/lim2.70044
  canonicalUrl: https://doi.org/10.1002/lim2.70044
  identityAliases:
  - DOI 10.1002/lim2.70044
  - 'The Influence of Immersion Environment on Mood: Comparing Sea Versus Laboratory Cold Exposure'
researchEvidence:
  designKind: crossover_trial
  designLabel: Within-subject crossover environment comparison
  populationLabel: Healthy university students (16 males, 11 females; mean age 20 ± 4 years).
  durationLabel: Two 5-minute immersions separated by 1 week.
  cohortKey: cohort:doi-10.1002-lim2.70044
  participantCount: 27
  participantCountKind: reported
  aggregateRole: primary
  notes:
  - 'Intervention/exposure: Two individually completed 5-minute chest-deep cold-water immersions, one in the sea and one in a laboratory tank, 1 week apart.'
  - 'Comparator/control: Within-subject comparison of sea versus laboratory immersion environment.'
  - 'Endpoints: total mood disturbance; esteem-related affect; vigour; POMS-SF subscales; environment context'
  - 'Effect direction: Mood improved after both immersions; sea immersion produced a modestly greater reduction in total mood disturbance and larger increase in esteem-related affect than laboratory immersion.'
  - 'Safety/adverse-event notes: No adverse event was extracted from the accessible abstract; participants were healthy students and immersions were individual and structured.'
  - 'Limitations: No non-immersion control condition extracted.; University student sample.; Environment cannot be separated from all outdoor/nature context factors.'
  - 'Population/directness caveat: Young healthy students; not older, clinical, cardiovascular-risk, or home users.'
  - 'Directness to Cold Plunge: direct_protocol'
  - 'Cold Plunge extraction context: bucket=Direct cold-plunge intervention evidence; directness=direct_protocol; claimUse=supports-protocol; priority=high'
sourceFindings:
- findingId: finding:doi-10.1002-lim2.70044:mood-both-settings
  sourceKey: source_artifact:doi-10.1002-lim2.70044
  extractedFromArtifactId: art_doi_10_1002_lim2_70044
  findingKind: intervention_result
  population: Healthy university students
  exposure: 5-minute chest-deep sea and laboratory tank cold-water immersion
  outcome: Profile of Mood States mood scores
  summary: Mood improved after both sea and laboratory cold-water immersions, supporting an acute mood signal not limited to open-water swimming.
  evidenceUse:
  - efficacy
- findingId: finding:doi-10.1002-lim2.70044:sea-setting-modifier
  sourceKey: source_artifact:doi-10.1002-lim2.70044
  extractedFromArtifactId: art_doi_10_1002_lim2_70044
  findingKind: context
  population: Healthy university students
  exposure: Sea versus laboratory cold-water immersion
  outcome: Environment-related mood modulation
  summary: Sea immersion produced modestly greater total mood disturbance and esteem-related affect changes, indicating environment may modify psychological response.
  evidenceUse:
  - context
coldPlungeExtraction:
  batchId: batch-001
  evidenceBucket: Direct cold-plunge intervention evidence
  directness: direct_protocol
  claimUse: supports-protocol
  priority: high
  artifactRightsStatusGuess: open_access
  identityResolutionStatus: new_source
aliases:
- DOI 10.1002/lim2.70044
- 'The Influence of Immersion Environment on Mood: Comparing Sea Versus Laboratory Cold Exposure'
- 10.1002/lim2.70044
---

This source is included for **Direct cold-plunge intervention evidence**.

**Findings:** Mood improved after both sea and laboratory cold-water immersions, supporting an acute mood signal not limited to open-water swimming. Sea immersion produced modestly greater total mood disturbance and esteem-related affect changes, indicating environment may modify psychological response.

**Why it matters:** Helps separate cold exposure from environment/nature effects in mood outcomes.

**Potential experiment signals:** total mood disturbance; esteem-related affect; vigour; POMS-SF subscales; environment context.

**Protocol takeaway:** Supports that a 5-minute immersion can improve acute mood in both lab and sea contexts, with sea setting modestly enhancing the effect.

**Claim use:** `supports-protocol`.

**Population mismatch:** Young healthy students; not older, clinical, cardiovascular-risk, or home users.

**Limitations:** No non-immersion control condition extracted.; University student sample.; Environment cannot be separated from all outdoor/nature context factors.

**Artifact and rights note:** Metadata and source page draft only. PDF rights status is `open_access`; do not place copyrighted PDFs in Git unless rights are clearly open and redistributable.
