---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:clinicaltrials-nct05956392-2026-04-24"
slug: "sources/evening-screen-curfew/clinicaltrials-nct05956392-2026-04-24"
title: Personalising Children's Screen Use Reduction for Better Sleep
summary: Singapore registry record for personalized child screen-use reduction to improve sleep; adjacent because it is not a fixed no-personal-screens-before-bed protocol and has no extracted results.
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
  kind: web_page
  title: Personalising Children's Screen Use Reduction for Better Sleep
  authors: ClinicalTrials.gov registry record
  year: 2023
  journal: ClinicalTrials.gov
  url: "https://clinicaltrials.gov/study/NCT05956392"
  citation: "ClinicalTrials.gov. NCT05956392: Personalising Children's Screen Use Reduction for Better Sleep."
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Randomized trial registry record
  participantCount: 150
  participantCountKind: reported
  populationLabel: "Singapore children aged 6-12 years with school-day sleep under 8 hours and media use over 2 hours/day."
  durationLabel: Two-week schedule plus follow-up assessments two weeks after the intervention ended.
  cohortKey: clinicaltrials-nct05956392-2026-04-24
  aggregateRole: primary
  notes:
  - "Directness classification: adjacent_variant."
  - "Protocol claim-use classification: context-only."
  - "Discovery shards: direct-intervention. Year(s): year not listed. Candidate rationale: Relevant local/Singapore trial registry record for screen reduction and sleep; bedtime anchoring needs confirmation before protocol use."
sourceContext:
  evidenceBucket: adjacent_behavioral_interventions
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  batchId: batch-002
  ledgerStudyDesign: rct
  canonicalIdBasis: url
  artifactRightsStatusGuess: unknown
  needsSourcePage: true
  needsArtifactManifestEntry: false
---

This source is included for **adjacent_behavioral_interventions** in the Digital Sunset research workspace.

## Extraction status
Draft extraction for `batch-002` / adjacent behavioral intervention variants. Directness is `adjacent_variant` and claim use is `context-only`. This page is not a protocol synthesis.

## Methods snapshot
- **Design:** Randomized trial registry record.
- **Participants:** planned recruitment target in accessible registry mirror; Singapore children aged 6-12 years with school-day sleep under 8 hours and media use over 2 hours/day.
- **Intervention/exposure:** Personalized reallocation of at least 60 minutes of school-day media use toward sleep for two weeks; timing/type/duration chosen by participants/families.
- **Comparator/control:** Free-living control.
- **Duration/follow-up:** Two-week schedule plus follow-up assessments two weeks after the intervention ended.
- **Endpoints extracted:** daily sleep, time use, cognitive function, psychological well-being, high-density EEG in a subset.

## Results extracted
- Registry source describes an ongoing/recruiting adjacent screen-use reduction and sleep-extension trial; no outcome results extracted.
- The intervention targets media use across waking hours rather than only pre-bed personal screens.

## Digital Sunset relevance
This source is `adjacent_variant` for **Digital Sunset No Personal Screens Before Bed**. It should be used as `context-only` evidence only. Adjacent or mechanism findings must not be promoted into direct protocol efficacy claims.

## Safety/adverse events
- **Adverse events:** Not extracted.
- **Safety notes:** No safety result extracted from registry record.

## Limitations and population mismatch
- Registry-only, no results.
- Children in Singapore; timing is personalized and not necessarily a bedtime curfew.
- Co-targets sleep extension and screen reduction.

## Artifact and rights notes
Rights status guess: `unknown`. Registry metadata only; no artifact manifest entry requested.

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
