---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1002-lim2.70048
slug: sources/cold-water-immersion/doi-10.1002-lim2.70048
title: 'Improved Mood Following Cold-Water Immersion: A Comparison of Differing Exposure Durations'
summary: Total mood disturbance improved across immersion groups; largest change in 20-minute group, 5-minute group was similar and as effective as longer exposures in the abstract conclusion; control did not significantly change. Skin temperature fell, heart rate rose, and HRV indicated sympathetic shift in a 5-minute subgroup.
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
  title: 'Improved Mood Following Cold-Water Immersion: A Comparison of Differing Exposure Durations'
  authors: Kelly JS; Davidson N; Delaney JP
  year: 2026
  journal: Lifestyle Medicine
  doi: 10.1002/lim2.70048
  url: https://doi.org/10.1002/lim2.70048
  citation: 'Kelly JS; Davidson N; Delaney JP. Improved Mood Following Cold-Water Immersion: A Comparison of Differing Exposure Durations. Lifestyle Medicine. 2026. doi:10.1002/lim2.70048.'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1002/lim2.70048
    titleHash: bf5141ccffdee93692febdd961a0691e35341d7f33e8b82277d939e022c8e850
    url: https://doi.org/10.1002/lim2.70048
  canonicalUrl: https://doi.org/10.1002/lim2.70048
  identityAliases:
  - DOI 10.1002/lim2.70048
  - 'Improved Mood Following Cold-Water Immersion: A Comparison of Differing Exposure Durations'
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Randomized duration-comparison controlled trial
  populationLabel: Participants with self-reported low mood; healthy/screened context stated in accessible abstract conclusion.
  durationLabel: Single exposure with POMS 7 days before and immediately after immersion/control interval.
  cohortKey: cohort:doi-10.1002-lim2.70048
  participantCount: 140
  participantCountKind: reported
  aggregateRole: primary
  notes:
  - 'Intervention/exposure: Seawater cold-water immersion at 13.6 ± 0.3 °C for 5, 10, or 20 minutes.'
  - 'Comparator/control: Control group with matched POMS measurement interval and no immersion.'
  - 'Endpoints: total mood disturbance; skin temperature; heart rate; HRV RMSSD; HRV total power; exposure duration'
  - 'Effect direction: Total mood disturbance improved across immersion groups; largest change in 20-minute group, 5-minute group was similar and as effective as longer exposures in the abstract conclusion; control did not significantly change. Skin temperature fell, heart rate rose, and HRV indicated sympathetic shift in a 5-minute subgroup.'
  - 'Safety/adverse-event notes: Authors concluded the protocol was safe in healthy screened individuals under controlled conditions but advised caution in less structured environments or people with pre-existing health conditions.'
  - 'Limitations: Self-reported low mood rather than diagnosed condition.; Single immediate mood outcome.; HRV was analyzed in only 10 participants from the 5-minute group.; Seawater/natural setting may confound mood response.'
  - 'Population/directness caveat: Screened participants with self-reported low mood; not clinical diagnosis or unsupervised high-risk users.'
  - 'Directness to Cold Plunge: direct_protocol'
  - 'Cold Plunge extraction context: bucket=Direct cold-plunge dose and habituation evidence; directness=direct_protocol; claimUse=supports-protocol; priority=high'
sourceFindings:
- findingId: finding:doi-10.1002-lim2.70048:duration-mood
  sourceKey: source_artifact:doi-10.1002-lim2.70048
  extractedFromArtifactId: art_doi_10_1002_lim2_70048
  findingKind: intervention_result
  population: Participants with self-reported low mood
  exposure: Single 5-, 10-, or 20-minute seawater CWI at 13.6 °C
  outcome: Total mood disturbance
  summary: The randomized duration trial reported significant TMD improvement in all immersion groups, no significant control change, and a 5-minute exposure that was practically comparable to longer exposures in the abstract conclusion.
  evidenceUse:
  - efficacy
- findingId: finding:doi-10.1002-lim2.70048:autonomic-safety
  sourceKey: source_artifact:doi-10.1002-lim2.70048
  extractedFromArtifactId: art_doi_10_1002_lim2_70048
  findingKind: safety
  population: Screened participants with self-reported low mood
  exposure: Single seawater CWI at 13.6 °C
  outcome: Heart rate, HRV, and safety boundary
  summary: The source reported skin-temperature reduction, heart-rate increase, and reduced RMSSD/total HRV power in a small 5-minute subgroup, and advised caution outside controlled screened settings.
  evidenceUse:
  - safety
  - mechanism
coldPlungeExtraction:
  batchId: batch-001
  evidenceBucket: Direct cold-plunge dose and habituation evidence
  directness: direct_protocol
  claimUse: supports-protocol
  priority: high
  artifactRightsStatusGuess: open_access
  identityResolutionStatus: new_source
aliases:
- DOI 10.1002/lim2.70048
- 'Improved Mood Following Cold-Water Immersion: A Comparison of Differing Exposure Durations'
- 10.1002/lim2.70048
---

This source is included for **Direct cold-plunge dose and habituation evidence**.

**Findings:** The randomized duration trial reported significant TMD improvement in all immersion groups, no significant control change, and a 5-minute exposure that was practically comparable to longer exposures in the abstract conclusion. The source reported skin-temperature reduction, heart-rate increase, and reduced RMSSD/total HRV power in a small 5-minute subgroup, and advised caution outside controlled screened settings.

**Why it matters:** Direct duration-comparison mood trial that is highly relevant to practical cold-plunge dosing.

**Potential experiment signals:** total mood disturbance; skin temperature; heart rate; HRV RMSSD; HRV total power; exposure duration.

**Protocol takeaway:** Supports acute mood improvement after 5–20 minutes at 13.6 °C in screened participants, with 5 minutes appearing practically sufficient; do not infer long-term benefit.

**Claim use:** `supports-protocol`.

**Population mismatch:** Screened participants with self-reported low mood; not clinical diagnosis or unsupervised high-risk users.

**Limitations:** Self-reported low mood rather than diagnosed condition.; Single immediate mood outcome.; HRV was analyzed in only 10 participants from the 5-minute group.; Seawater/natural setting may confound mood response.

**Artifact and rights note:** Metadata and source page draft only. PDF rights status is `open_access`; do not place copyrighted PDFs in Git unless rights are clearly open and redistributable.
