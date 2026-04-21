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
evidenceBucket: "Wearable or testable signals"
whyItMatters: "Acute implementation source showing how heart rate behaves during a 4x4 session and why target-zone fidelity needs to be logged."
potentialMurphEndpoints:
  - estimated VO2max / cardio-fitness proxy
  - session heart-rate fidelity
  - heart-rate recovery
  - symptoms and adherence
protocolTakeaway: "Use only within the stated claimUse boundary when building the Norwegian 4x4 protocol."
studyDesign: "See source metadata and bibliography for exact design."
modality: Aerobic high-intensity interval training / Norwegian 4x4 context
norwegian4x4Focus: "Direct support"
claimUse: supports-protocol
murphV1Priority: High
pdfRightsStatus: open_access
aliases:
  - "doi-10.3390-ijerph17145103"
---

This source is included for **Wearable or testable signals**.

**Why it matters:** Acute implementation source showing how heart rate behaves during a 4x4 session and why target-zone fidelity needs to be logged.

**Protocol takeaway:** Use this source only within its `claimUse: supports-protocol` boundary. Do not use safety-only, mixed clinical, or adjacent-variant evidence as direct support for a general unsupervised self-experiment claim.
