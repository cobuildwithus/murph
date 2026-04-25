---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:clinicaltrials-nct04098913-2026-04-24"
slug: "sources/evening-screen-curfew/clinicaltrials-nct04098913-2026-04-24"
title: Short-term Efficacy of Reducing Screen-Based Media Use
summary: Registry counterpart for the SCREENS family recreational-screen reduction trial; useful for methods linkage, not direct bedtime-curfew evidence.
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
  title: Short-term Efficacy of Reducing Screen-Based Media Use
  authors: ClinicalTrials.gov registry record
  journal: ClinicalTrials.gov
  url: "https://clinicaltrials.gov/study/NCT04098913"
  citation: "ClinicalTrials.gov. NCT04098913: Short-term Efficacy of Reducing Screen-Based Media Use."
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Cluster randomized trial registry record
  populationLabel: Families with children; linked publication included children aged 4-14 years and adults.
  durationLabel: Two-week intervention in linked publication.
  cohortKey: clinicaltrials-nct04098913-2026-04-24
  aggregateRole: primary
  notes:
  - "Directness classification: adjacent_variant."
  - "Protocol claim-use classification: context-only."
  - "Discovery shards: direct-intervention. Year(s): year not listed. Candidate registry link to publication source_artifact:pmid-35604678; retain separately until verified in extraction. Candidate rationale: Registry record for the SCREENS family screen-reduction RCT; helpful for protocol details, but not a direct bedtime curfew."
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
- **Design:** Cluster randomized trial registry record.
- **Participants:** registry target not extracted; linked publication analyzed 89 families; Families with children; linked publication included children aged 4-14 years and adults.
- **Intervention/exposure:** Family-level reduction of recreational screen-based media use; linked SCREENS publication limited recreational screen media to 3 hours/week/person for 2 weeks and removed most portable devices.
- **Comparator/control:** Usual screen-media habits.
- **Duration/follow-up:** Two-week intervention in linked publication.
- **Endpoints extracted:** physical activity, sleep duration, sleep architecture/parameters, stress, well-being, mood.

## Results extracted
- Registry source supports methods/protocol linkage to the SCREENS family trial; outcome claims should use the journal publication source.
- Intervention was total recreational screen reduction, not bedtime-specific screen curfew.

## Digital Sunset relevance
This source is `adjacent_variant` for **Digital Sunset No Personal Screens Before Bed**. It should be used as `context-only` evidence only. Adjacent or mechanism findings must not be promoted into direct protocol efficacy claims.

## Safety/adverse events
- **Adverse events:** Not extracted.
- **Safety notes:** No safety result extracted from registry record.

## Limitations and population mismatch
- Registry-only extraction; use publication source for effect estimates.
- Family screen restriction is broader than Digital Sunset.

## Artifact and rights notes
Rights status guess: `unknown`. Registry metadata only; no artifact manifest entry requested.

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
