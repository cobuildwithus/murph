---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.3390-ijerph17145103
slug: sources/norwegian-4x4/doi-10.3390-ijerph17145103
title: "Characterizing the heart rate response to the 4 × 4 interval exercise protocol"
summary: "Acute implementation source showing how heart rate behaves during a 4x4 session and why target-zone fidelity needs to be logged."
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
protocolEvidence:
  -
    protocolKey: protocol_variant:norwegian-4x4/norwegian-4x4
    groupId: supports-fitness-claim
    stance: supports
    scope: measurement_context
    result: not_efficacy_evidence
    endpointKeys:
      - biomarker:estimated-vo2max
    headline: "The acute heart-rate study shows a completed 4x4 session should be judged by target-zone fidelity, not only by finishing four intervals."
    implication: "Log interval heart-rate peaks and time near target so the experiment knows whether the intended dose happened."
    caveat: "Single-session physiology is implementation evidence, not long-term efficacy evidence."
    displayPriority: 60
evidenceBucket: "Wearable or testable signals"
whyItMatters: "Acute implementation source showing how heart rate behaves during a 4x4 session and why target-zone fidelity needs to be logged."
potentialMurphEndpoints:
  - estimated VO2max / cardio-fitness proxy
  - session heart-rate fidelity
  - heart-rate recovery
  - symptoms and adherence
protocolTakeaway: "Use to judge session fidelity by heart-rate-zone behavior and repeatability, not merely by whether four intervals were completed."
murphTakeaway: "The main finding is that a 4x4 session should be judged by time in zone, not just by completing four intervals."
studyDesign: "Acute implementation physiology study"
modality: Aerobic high-intensity interval training / Norwegian 4x4 context
norwegian4x4Focus: "Direct support"
claimUse: supports-protocol
murphV1Priority: High
pdfRightsStatus: open_access
aliases:
  - "doi-10.3390-ijerph17145103"
---

This source is included for **Wearable or testable signals**.

## Quick read

- **Source type:** Acute implementation physiology study (2020).
- **People studied or addressed:** Healthy active adults (39 participants).
- **Role in Murph:** direct or close support for the cardio-fitness claim; supports evidence; useful for measurement and logging, not for efficacy proof.
- **Most relevant Murph signals:** estimated VO2max / cardio-fitness proxy, session heart-rate fidelity, heart-rate recovery, symptoms and adherence.

## Why it matters for Norwegian 4x4

Acute implementation source showing how heart rate behaves during a 4x4 session and why target-zone fidelity needs to be logged.

## What it found

**Findings:** The study tracked heart-rate behavior during one 4x4 cycling session. Participants spent most of the protocol in the intended high-intensity heart-rate range, and later intervals reached target intensity more reliably than the first. For Murph, the main finding is that a 4x4 session should be judged by time in zone, not just by completing four intervals.

## How Murph should use it

Log interval heart-rate peaks and time near target so the experiment knows whether the intended dose happened.

Use to judge session fidelity by heart-rate-zone behavior and repeatability, not merely by whether four intervals were completed.

## Important limits

Single-session physiology is implementation evidence, not long-term efficacy evidence.

The safe interpretation is narrower than “4x4 is always better.” Keep the population, supervision level, comparator, and exact interval dose visible before applying this source to a home wearable experiment.

## Plain-language takeaway

For a generally healthy user, this belongs in the evidence pile that makes a 6-week 4x4 fitness test plausible, as long as the session is actually hard enough and recovery stays reasonable.
