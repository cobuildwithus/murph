---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:clinicaltrials-nct05820555-2026-04-24"
slug: "sources/evening-screen-curfew/clinicaltrials-nct05820555-2026-04-24"
title: The Goodnight Screen Media Study
summary: "ClinicalTrials.gov registry for a preschool-child evening tablet/no-screen trial; active/planned results context only."
status: draft
quality: usable
categories:
- evening-screen-curfew
- digital-sunset
- direct_protocol_trials_and_registries
relations:
-
  type: related_protocol
  target: "protocol_variant:evening-screen-curfew/digital-sunset"
-
  type: parent_family
  target: "experiment_family:evening-screen-curfew"
source:
  kind: web_page
  title: The Goodnight Screen Media Study
  authors: ClinicalTrials.gov record; Baylor College of Medicine sponsor
  journal: ClinicalTrials.gov
  url: "https://clinicaltrials.gov/study/NCT05820555"
  citation: "ClinicalTrials.gov. NCT05820555: The Goodnight Screen Media Study."
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Randomized parallel interventional trial registry
  participantCount: 180
  participantCountKind: reported
  populationLabel: "Preschool children aged 48-59 months and parents/caregivers"
  durationLabel: "Three-week protocol with baseline, no-screen run-in, and assigned evening screen/no-screen condition"
  cohortKey: clinicaltrials-nct05820555-2026-04-24
  aggregateRole: primary
  notes:
  - "Directness classification: direct_protocol."
  - "Protocol claim-use classification: context-only."
  - "Discovery shards: direct-intervention, light-circadian-mechanism. Year(s): year not listed. Candidate registry link to protocol/publication source_artifact:pmid-39163119; retain separately until verified in extraction. Candidate rationale: Active/registered direct trial comparing timed evening tablet exposure with an evening no-screen condition; no peer-reviewed results found in this pass. Additional shard rationales exist; preserve mixed/directness classifications during extraction."
sourceContext:
  evidenceBucket: direct_protocol_trials_and_registries
  directness: direct_protocol
  claimUse: context-only
  priority: high
  batchId: batch-001
  ledgerStudyDesign: rct
  canonicalIdBasis: url
  artifactRightsStatusGuess: unknown
  needsSourcePage: true
  needsArtifactManifestEntry: false
---

This source is included for **direct_protocol_trials_and_registries** in batch `batch-001`.

## Quick read

ClinicalTrials.gov registry for a preschool-child evening tablet/no-screen trial; active/planned results context only.

## Extracted intervention or exposure

- **Population / N:** Preschool children aged 48-59 months and parents/caregivers (N=180 ; count kind: estimated enrollment).
- **Intervention / exposure:** Evening tablet timing conditions: tablet use in the hour before bed, tablet use two hours before bed with no final-hour screen, and no evening screen media/no screen in the three hours before bed.
- **Comparator / control:** No evening screen media condition.
- **Duration / follow-up:** Three-week protocol with baseline, no-screen run-in, and assigned evening screen/no-screen condition

## Extracted endpoints and results

- **Endpoints:** Circadian phase/melatonin, sleep latency, sleep duration, and executive-function outcomes.
- **Effect or direction:** No peer-reviewed results extracted. Treat as active/registered trial-landscape evidence only.

## Directness and claim boundary

- **Directness to Digital Sunset:** direct_protocol.
- **Claim use:** context-only.
- **Boundary:** Preschool-child exposure/timing trial, registry-only status, and no results. Adult digital-sunset relevance is indirect.

## Safety / adverse events

No adverse-event findings extracted from registry-level access.

## Artifact candidates and rights

- **Rights status:** unknown.
- **Artifact note:** Registry record only; no peer-reviewed results extracted. Do not conflate with the JMIR child crossover protocol unless linkage is independently verified.

## Extraction cautions

Do not synthesize this source across studies inside the source page. Preserve null, mixed, feasibility-only, protocol-only, and population-mismatch status exactly as extracted.

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
