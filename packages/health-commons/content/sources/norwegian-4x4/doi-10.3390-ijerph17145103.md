---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.3390-ijerph17145103
slug: sources/norwegian-4x4/doi-10.3390-ijerph17145103
title: "Characterizing the heart rate response to the 4 × 4 interval exercise protocol"
summary: "Acute implementation study showing that a 4x4 session should be judged by time in the target zone, not just by finishing four intervals."
status: draft
quality: usable
categories:
  - norwegian-4x4
  - hiit
  - exercise
relations:

  -
    type: related_protocol
    target: protocol_variant:norwegian-4x4/norwegian-4x4
  -
    type: parent_family
    target: experiment_family:norwegian-4x4
source:
  kind: journal_article
  title: "Characterizing the heart rate response to the 4 × 4 interval exercise protocol"
  authors: "J J Acala, D Roche-Willis, T A Astorino"
  year: 2020
  journal: "International Journal of Environmental Research and Public Health"
  citation: "J J Acala, D Roche-Willis, T A Astorino. Characterizing the heart rate response to the 4 × 4 interval exercise protocol. International Journal of Environmental Research and Public Health. 2020. doi:10.3390/ijerph17145103"
  doi: "10.3390/ijerph17145103"
  url: https://www.mdpi.com/1660-4601/17/14/5103
researchEvidence:
  designKind: "acute_mechanistic"
  designLabel: "Acute implementation physiology study"
  participantCount: 39
  participantCountKind: "reported"
  populationLabel: "Healthy active adults"
  durationLabel: "Single 4x4 cycling session"
  aggregateRole: "primary"
  cohortKey: "acala-2020-4x4-hr-response"
evidenceBucket: "Dose, target zone, and implementation"
whyItMatters: "Shows why target-zone fidelity should be logged instead of assuming that completing four intervals means the intended 4x4 dose was achieved."
potentialMurphEndpoints:
  - estimated VO2max / cardio-fitness proxy
  - session heart-rate fidelity
  - heart-rate recovery
  - symptoms and adherence
protocolTakeaway: "Use to judge whether the session really hit the intended dose: log interval peaks, approximate time in zone, and whether later intervals reached the target more reliably than the first."
murphTakeaway: "Use to judge whether the session really hit the intended dose rather than to claim a long-term health effect from one acute physiology paper."
studyDesign: "Acute implementation physiology study"
modality: Aerobic high-intensity interval training / Norwegian 4x4 context
norwegian4x4Focus: "Direct support"
claimUse: supports-protocol
murphV1Priority: High
pdfRightsStatus: open_access
aliases:
  - "doi-10.3390-ijerph17145103"
---

This source is included for **Dose, target zone, and implementation**.

## Quick read

- **Source type:** Acute implementation physiology study (2020).
- **People studied or addressed:** Healthy active adults (39 participants).
- **Role in Murph:** dose-fidelity evidence; helps interpret whether a session actually counted as the intended 4x4 stimulus.
- **Most relevant Murph signals:** estimated VO2max / cardio-fitness proxy, session heart-rate fidelity, heart-rate recovery, symptoms and adherence.

## Why it matters for Norwegian 4x4

A session can look complete on paper while still missing the intended dose.

## What it found

**Findings:** The study tracked heart-rate behavior during one 4x4 cycling session. Participants spent more time in the intended high-intensity zone during the later intervals than during the first interval, which means “four intervals completed” is not the same as “the right 4x4 dose happened.” For Murph, that makes interval peaks and approximate time in zone part of the experiment record.

## How Murph should use it

Use it to decide whether a workout was a real 4x4 session or just a hard workout that never quite reached the intended zone.

## Important limits

This is a single-session implementation study, not a long-term outcome trial.

## Plain-language takeaway

Finishing the workout is not enough; you want the last half of the hard reps to actually live in the intended zone.
