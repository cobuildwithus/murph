---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:clinicaltrials-nct06192745-2026-04-24"
slug: "sources/evening-screen-curfew/clinicaltrials-nct06192745-2026-04-24"
title: "SCREENS: Sleep, Circadian Rhythms, and Electronics in Children Study"
summary: "Pediatric registry source on evening tablet light/content mechanisms; no results and no direct Digital Sunset claim."
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
  title: "SCREENS: Sleep, Circadian Rhythms, and Electronics in Children Study"
  authors: ClinicalTrials.gov registry record
  year: 2024
  journal: ClinicalTrials.gov
  url: "https://clinicaltrials.gov/study/NCT06192745"
  citation: "ClinicalTrials.gov. NCT06192745: SCREENS: Sleep, Circadian Rhythms, and Electronics in the EveNing Study."
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Randomized trial registry record
  populationLabel: Children, accessible snippets indicate ages 8-11 years.
  durationLabel: Not extracted from accessible registry text.
  cohortKey: clinicaltrials-nct06192745-2026-04-24
  aggregateRole: primary
  notes:
  - "Directness classification: same_mechanism."
  - "Protocol claim-use classification: context-only."
  - "Discovery shards: adolescent-family-school, light-circadian-mechanism. Year(s): 2024. Deduped proposed keys: source_artifact:clinicaltrials-nct06192745, source_artifact:clinicaltrials-nct06192745-2026-04-24. Candidate rationale: Pediatric/adolescent registry source on tablet exposure and circadian endpoints; no outcome claims until results are available. Additional shard rationales exist; preserve mixed/directness classifications during extraction."
sourceContext:
  evidenceBucket: adjacent_behavioral_interventions
  directness: same_mechanism
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
Draft extraction for `batch-002` / adjacent behavioral intervention variants. Directness is `same_mechanism` and claim use is `context-only`. This page is not a protocol synthesis.

## Methods snapshot
- **Design:** Randomized trial registry record.
- **Participants:** not extracted from accessible registry text; Children, accessible snippets indicate ages 8-11 years.
- **Intervention/exposure:** Evening tablet exposure conditions intended to disentangle light emitted from devices from arousing media content.
- **Comparator/control:** Other evening tablet/light/content exposure conditions; exact arms not fully extracted.
- **Duration/follow-up:** Not extracted from accessible registry text.
- **Endpoints extracted:** sleep regulation, circadian physiology, next-day emotion regulation, executive function.

## Results extracted
- Registry source has no extracted results; do not make outcome claims.
- It is useful for mechanism context: evening device light and arousing content are being experimentally separated.

## Digital Sunset relevance
This source is `same_mechanism` for **Digital Sunset No Personal Screens Before Bed**. It should be used as `context-only` evidence only. Adjacent or mechanism findings must not be promoted into direct protocol efficacy claims.

## Safety/adverse events
- **Adverse events:** Not extracted.
- **Safety notes:** No safety result extracted from registry record.

## Limitations and population mismatch
- Registry-only source with no results.
- Tablet exposure/mechanism trial, not a pragmatic curfew protocol.
- Pediatric sample limits adult generalization.

## Artifact and rights notes
Rights status guess: `unknown`. Registry metadata only; no artifact manifest entry requested.

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
