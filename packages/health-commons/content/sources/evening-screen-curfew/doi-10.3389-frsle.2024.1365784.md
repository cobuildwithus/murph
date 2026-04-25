---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:doi-10.3389/frsle.2024.1365784"
slug: "sources/evening-screen-curfew/doi-10.3389-frsle.2024.1365784"
title: "Case report: Nighttime media restriction for pediatric insomnia"
summary: Single pediatric case report described nighttime digital-device restriction after 9 pm with improved sleep duration and daytime sleepiness and no reported adverse event; use only as low-certainty safety and adherence context.
status: draft
quality: usable
categories:
- evening-screen-curfew
- digital-sunset
- safety-burden-life-fit
- safety_burden_life_fit
relations:
-
  type: related_protocol
  target: "protocol_variant:evening-screen-curfew/digital-sunset"
-
  type: parent_family
  target: "experiment_family:evening-screen-curfew"
source:
  kind: journal_article
  title: "Case report: Nighttime media restriction for pediatric insomnia"
  authors: Arai Y, Sasayama D, Suzuki K, Watanabe J, Kuraishi Y, Koido M, Washizuka S
  year: 2024
  journal: Frontiers in Sleep
  doi: "10.3389/frsle.2024.1365784"
  url: "https://www.frontiersin.org/journals/sleep/articles/10.3389/frsle.2024.1365784/full"
  citation: "Arai Y, Sasayama D, Suzuki K, Watanabe J, Kuraishi Y, Koido M, Washizuka S. Case report: Nighttime media restriction for pediatric insomnia. Frontiers in Sleep. 2024;3:1365784. doi:10.3389/frsle.2024.1365784."
researchEvidence:
  designKind: single_person_report
  designLabel: Case Report
  populationLabel: 13-year-old boy with chronic insomnia, daytime sleepiness, and excessive nocturnal media use.
  durationLabel: 16-week treatment period with follow-up in the case report.
  aggregateRole: primary
  notes:
  - "Directness classification: safety_boundary."
  - "Protocol claim-use classification: safety-only."
  - "Discovery shards: direct-intervention. Year(s): 2024. Candidate rationale: Low-level evidence but directly relevant to safety/adherence: reports nighttime restriction, symptom changes, and absence of major adverse events in one case."
sourceContext:
  evidenceBucket: safety_burden_life_fit
  directness: safety_boundary
  claimUse: safety-only
  priority: medium
  batchId: batch-008
  ledgerStudyDesign: case_report
  canonicalIdBasis: doi
  artifactRightsStatusGuess: open_access
  needsSourcePage: true
  needsArtifactManifestEntry: false
---

This source is included for **safety, burden, withdrawal, and clinical-boundary evidence** in the Digital Sunset extraction batch.

## Quick read

- **Source type:** Case Report (2024).
- **People studied or addressed:** 13-year-old boy with chronic insomnia, daytime sleepiness, and excessive nocturnal media use.
- **Exposure/intervention:** Nighttime digital-device/media restriction after 9 pm with sleep-hygiene guidance.
- **Comparator/control:** Clinical baseline before restriction.
- **Role for Digital Sunset:** safety_boundary; safety-only. This source is not upgraded to direct Digital Sunset efficacy unless the source itself directly tested no personal screens before bed.

## Extracted source-local finding

A single 13-year-old insomnia case linked to excessive nighttime media use reportedly improved after digital-device restriction after 9 pm, with normalized total sleep time, resolved daytime sleepiness over 16 weeks, and no adverse event reported.

## Endpoints extracted

total sleep time, daytime sleepiness, insomnia symptoms, adverse events

## Duration or follow-up

16-week treatment period with follow-up in the case report.

## Safety, adverse events, and clinical boundaries

No adverse event was reported in this one case, but this is insufficient to conclude general safety. Pediatric insomnia and comorbid conditions require clinical context.

## Important limits and population mismatch

- Single case report; no randomization or control group.
- Pediatric insomnia case with clinical oversight, not a general adult bedtime-screen protocol.
- Combined nighttime media restriction with broader sleep-hygiene guidance.

## Artifact and rights notes

- **Rights status guess:** open_access
- **Artifact handling:** metadata/manifest candidate only unless a directly redistributable open-license artifact is verified. Copyrighted PDFs should not be committed to Git.

## Source key

`source_artifact:doi-10.3389/frsle.2024.1365784`

---

---

**Extraction boundary:** This page preserves source-level extraction and should not be used as cross-source synthesis by itself. Preserve null, mixed, safety-only, and population-mismatch findings when citing it.
