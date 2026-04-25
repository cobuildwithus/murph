---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:clinicaltrials-nct03752385-2026-04-24"
slug: "sources/evening-screen-curfew/clinicaltrials-nct03752385-2026-04-24"
title: The Effects of Smartphone Use on Physical Activity, Sedentary Behavior, Mood and Sleep
summary: "Registry for a bundled smartphone-reduction RCT that includes phone bedtime/out-of-bedroom elements; relevant context but not direct evidence."
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
  title: The Effects of Smartphone Use on Physical Activity, Sedentary Behavior, Mood and Sleep
  authors: ClinicalTrials.gov registry record
  journal: ClinicalTrials.gov
  url: "https://clinicaltrials.gov/study/NCT03752385"
  citation: "ClinicalTrials.gov. NCT03752385: The Effects of Smartphone Use on Physical Activity, Sedentary Behavior, Mood and Sleep."
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Randomized trial registry record
  populationLabel: Adolescents and young adults, approximately ages 13-25, per accessible registry snippets.
  durationLabel: Not extracted from accessible registry text.
  cohortKey: clinicaltrials-nct03752385-2026-04-24
  aggregateRole: primary
  notes:
  - "Directness classification: adjacent_variant."
  - "Protocol claim-use classification: context-only."
  - "Discovery shards: direct-intervention. Year(s): year not listed. Candidate rationale: Includes a phone bedtime and out-of-bedroom component, but bundled with broader daily smartphone reduction."
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
- **Participants:** not extracted from accessible registry text; Adolescents and young adults, approximately ages 13-25, per accessible registry snippets.
- **Intervention/exposure:** Reduce smartphone screen time by half, sleep without the phone in the bedroom, and set a phone bedtime.
- **Comparator/control:** Use smartphone as normal or no intervention control; exact comparator not fully extracted.
- **Duration/follow-up:** Not extracted from accessible registry text.
- **Endpoints extracted:** sleep, physical activity, sedentary behavior, mood, mental health.

## Results extracted
- Registry source describes an adjacent bundled smartphone reduction intervention; no results extracted.
- The phone-bedtime component is bundled with total daily smartphone reduction and out-of-bedroom behavior.

## Digital Sunset relevance
This source is `adjacent_variant` for **Digital Sunset No Personal Screens Before Bed**. It should be used as `context-only` evidence only. Adjacent or mechanism findings must not be promoted into direct protocol efficacy claims.

## Safety/adverse events
- **Adverse events:** Not extracted.
- **Safety notes:** No safety result extracted.

## Limitations and population mismatch
- Registry-only source with no extracted results.
- Bundled intervention prevents isolation of Digital Sunset.

## Artifact and rights notes
Rights status guess: `unknown`. Registry metadata only; no artifact manifest entry requested.

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
