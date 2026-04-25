---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:anzctr-bed-electronic-devices-2026-04-24"
slug: "sources/evening-screen-curfew/anzctr-bed-electronic-devices-2026-04-24"
title: How do electronic devices influence sleep in children? The Bedtime Electronic Devices (BED) study
summary: Registry source for the BED observational study; useful for objective bedtime-screen measurement context, not as intervention evidence.
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
  title: How do electronic devices influence sleep in children? The Bedtime Electronic Devices (BED) study
  authors: ANZCTR registry record
  year: 2021
  journal: Australian New Zealand Clinical Trials Registry
  url: "https://www.anzctr.org.au/Trial/Registration/TrialReview.aspx?id=380926&isReview=true"
  citation: "Australian New Zealand Clinical Trials Registry. ACTRN12621000193875: Streaming before dreaming: How do electronic devices influence sleep in children? The Bedtime Electronic Devices (BED) study. Registered 23 Feb 2021; results posted 27 Jul 2025."
researchEvidence:
  designKind: other
  designLabel: Prospective observational natural-history study
  participantCount: 85
  participantCountKind: reported
  populationLabel: Healthy volunteers aged 11 to under 15 years in Dunedin, New Zealand.
  durationLabel: One week of home monitoring.
  cohortKey: anzctr-bed-electronic-devices-2026-04-24
  aggregateRole: primary
  notes:
  - "Directness classification: background."
  - "Protocol claim-use classification: context-only."
  - "Discovery shards: bedtime-procrastination-displacement. Year(s): 2021. Candidate rationale: Registry context for the Bedtime Electronic Devices study family and objective bedtime-screen measurement work."
sourceContext:
  evidenceBucket: adjacent_behavioral_interventions
  directness: background
  claimUse: context-only
  priority: medium
  batchId: batch-002
  ledgerStudyDesign: other
  canonicalIdBasis: url
  artifactRightsStatusGuess: unknown
  needsSourcePage: true
  needsArtifactManifestEntry: false
---

This source is included for **adjacent_behavioral_interventions** in the Digital Sunset research workspace.

## Extraction status
Draft extraction for `batch-002` / adjacent behavioral intervention variants. Directness is `background` and claim use is `context-only`. This page is not a protocol synthesis.

## Methods snapshot
- **Design:** Prospective observational natural-history study.
- **Participants:** actual final sample size reported in registry; Healthy volunteers aged 11 to under 15 years in Dunedin, New Zealand.
- **Intervention/exposure:** No assigned intervention; one-week home monitoring of evening screen use, including objective cameras before bedtime and in bedroom overnight, plus actigraphy/heart-rate and questionnaires.
- **Comparator/control:** Not applicable; uncontrolled observational exposure measurement.
- **Duration/follow-up:** One week of home monitoring.
- **Endpoints extracted:** sleep duration, sleep efficiency, diet, well-being, mood, sleep impairment, physical activity, sedentary behavior.

## Results extracted
- Registry source provides study design, measurement, and sample details; no protocol-effect outcome should be inferred from this registry record alone.
- Publications were listed by the registry, but this source page does not extract their outcome claims.

## Digital Sunset relevance
This source is `background` for **Digital Sunset No Personal Screens Before Bed**. It should be used as `context-only` evidence only. Adjacent or mechanism findings must not be promoted into direct protocol efficacy claims.

## Safety/adverse events
- **Adverse events:** No intervention adverse events applicable in the registry extraction.
- **Safety notes:** Camera-based objective bedroom monitoring may have privacy/acceptability implications, but no adverse-event data were extracted.

## Limitations and population mismatch
- Observational uncontrolled design cannot establish causal effects of screen restriction.
- Children/adolescents in New Zealand; not adult self-experiment population.
- Registry record is useful mainly for measurement context.

## Artifact and rights notes
Rights status guess: `unknown`. Registry URL/metadata only; no artifact manifest entry requested.

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
