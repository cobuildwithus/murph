---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:doi-10.1097/jom.0000000000002941"
slug: "sources/evening-screen-curfew/doi-10.1097-jom.0000000000002941"
title: "The Tech4Rest Randomized Controlled Trial: Applying the Hierarchy of Controls to Advance the Sleep, Health, and Well-being of Team Truck Drivers"
summary: Occupational sleep-health RCT with broad cab and behavioral controls; useful implementation context only.
status: draft
quality: usable
categories:
- evening-screen-curfew
- digital-sunset
- adjacent-behavioral-interventions
- adjacent_behavioral_interventions
relations:
-
  type: related_protocol
  target: "protocol_variant:evening-screen-curfew/digital-sunset"
-
  type: parent_family
  target: "experiment_family:evening-screen-curfew"
source:
  kind: journal_article
  title: "The Tech4Rest Randomized Controlled Trial: Applying the Hierarchy of Controls to Advance the Sleep, Health, and Well-being of Team Truck Drivers"
  authors: Olson R, Johnson PW, Shea SA, Marino M, Springer R, Rice SPM, Rimby J, Donovan C
  year: 2023
  journal: Journal of Occupational and Environmental Medicine
  doi: "10.1097/jom.0000000000002941"
  url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11098532/"
  citation: "Olson R, Johnson PW, Shea SA, Marino M, Springer R, Rice SPM, Rimby J, Donovan C. The Tech4Rest Randomized Controlled Trial: Applying the Hierarchy of Controls to Advance the Sleep, Health, and Well-being of Team Truck Drivers. J Occup Environ Med. 2023;65(11):937-948. doi:10.1097/JOM.0000000000002941."
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Randomized controlled trial
  participantCount: 49
  participantCountKind: reported
  populationLabel: "Team truck drivers sleeping/working in occupational vehicle settings."
  durationLabel: Baseline 3-4 weeks, cab-enhancement period 3-4 weeks, and cab-enhancement plus behavioral program 1-2 months.
  cohortKey: doi-10.1097-jom.0000000000002941
  aggregateRole: primary
  notes:
  - "Directness classification: adjacent_variant."
  - "Protocol claim-use classification: context-only."
  - "Discovery shards: sleep-hygiene-guidelines-bundles. Year(s): 2023. Candidate rationale: Occupational sleep-health bundle with a bounded screen-off behavior; useful as adult implementation context but not a screen-curfew-only trial."
sourceContext:
  evidenceBucket: adjacent_behavioral_interventions
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  batchId: batch-002
  ledgerStudyDesign: rct
  canonicalIdBasis: doi
  artifactRightsStatusGuess: open_access
  needsSourcePage: true
  needsArtifactManifestEntry: false
---

This source is included for **adjacent_behavioral_interventions** in the Digital Sunset research workspace.

## Extraction status
Draft extraction for `batch-002` / adjacent behavioral intervention variants. Directness is `adjacent_variant` and claim use is `context-only`. This page is not a protocol synthesis.

## Methods snapshot
- **Design:** Randomized controlled trial.
- **Participants:** team truck drivers; 24 teams randomized; Team truck drivers sleeping/working in occupational vehicle settings.
- **Intervention/exposure:** Cab enhancements including active suspension seat and therapeutic mattress, followed by a behavioral sleep-health program; included a bounded screen-off behavior as part of the broader sleep-health bundle.
- **Comparator/control:** Work as usual control.
- **Duration/follow-up:** Baseline 3-4 weeks, cab-enhancement period 3-4 weeks, and cab-enhancement plus behavioral program 1-2 months.
- **Endpoints extracted:** sleep outcomes, health and well-being, objectively measured physical activity.

## Results extracted
- Sleep outcomes trended in the intervention-favoring direction but the extracted summary emphasizes large/statistically significant effects for objectively measured physical activity.
- Screen-off behavior was embedded in an occupational sleep-health bundle and cannot isolate Digital Sunset effects.

## Digital Sunset relevance
This source is `adjacent_variant` for **Digital Sunset No Personal Screens Before Bed**. It should be used as `context-only` evidence only. Adjacent or mechanism findings must not be promoted into direct protocol efficacy claims.

## Safety/adverse events
- **Adverse events:** Not extracted in this batch.
- **Safety notes:** Occupational context involves safety-sensitive driving; however no intervention adverse-event finding was extracted here.

## Limitations and population mismatch
- Small sample, 61.3% of planned enrollment.
- Bundled engineering and behavioral controls prevent isolation of screen curfew.
- Team truck-driver context is a strong population mismatch for ordinary evening home routines.

## Artifact and rights notes
Rights status guess: `open_access`. PMC metadata available; verify license before storing article/PDF.

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
