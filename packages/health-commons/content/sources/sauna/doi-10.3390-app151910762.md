---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.3390-app151910762
slug: sources/sauna/doi-10.3390-app151910762
title: "Effect of a Four-Week Extreme Heat (100 ± 2 °C) Sauna Baths Program in Combination with Resistance Training on Lower Limb Strength and Body Composition: A Blinded, Randomized Study"
summary: "This blinded randomized study tested a four-week 100 °C sauna program combined with resistance training. The main finding is that very high heat plus training is a distinct, higher-burden intervention that may affect strength or body-composition context. For Murph, it sets an upper-bound dose case rather than a default consumer protocol."
status: draft
quality: usable
categories:
  - sauna
  - randomized-trial
relations:
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  -
    type: parent_family
    target: experiment_family:dry-sauna
source:
  kind: journal_article
  title: "Effect of a Four-Week Extreme Heat (100 ± 2 °C) Sauna Baths Program in Combination with Resistance Training on Lower Limb Strength and Body Composition: A Blinded, Randomized Study"
  authors: Bartolomé I, et al
  year: 2025
  journal: Applied Sciences
  citation: "Bartolomé I, et al. Effect of a Four-Week Extreme Heat (100 ± 2 °C) Sauna Baths Program in Combination with Resistance Training on Lower Limb Strength and Body Composition: A Blinded, Randomized Study. Applied Sciences. 2025;15(19):10762. doi:10.3390/app151910762."
  doi: 10.3390/app151910762
  url: https://www.mdpi.com/2076-3417/15/19/10762
researchEvidence:
  designKind: "randomized_controlled_trial"
  designLabel: "Blinded heat-plus-resistance RCT"
  participantCount: 29
  participantCountKind: "approximate"
  populationLabel: "Resistance-trained adults"
  durationLabel: "4-week sauna-plus-resistance intervention"
  aggregateRole: "primary"
  cohortKey: "vojta-2025-extreme-heat-resistance-rct"
evidenceBucket: Intervention design / reality checks
whyItMatters: Adds a newer randomized dry-sauna training study and defines an upper-bound intensity that is far more aggressive than most consumer protocols.
potentialMurphEndpoints:
  - Strength performance
  - body mass
  - training logs
  - soreness
  - recovery ratings
protocolTakeaway: Use it as a boundary case for heat dose, not as a default consumer protocol; most first tests should be milder and more adherable.
murphTakeaway: "This source sets an upper-bound dose case rather than a default consumer protocol."
studyDesign: RCT
modality: Sauna (likely dry)
finnishDrySaunaFocus: Likely
murphV1Priority: Medium
---

This source is included for **Intervention design / reality checks**.

**Findings:** This blinded randomized study tested a four-week 100 °C sauna program combined with resistance training. The main finding is that very high heat plus training is a distinct, higher-burden intervention that may affect strength or body-composition context.

**Why it matters:** Adds a newer randomized dry-sauna training study and defines an upper-bound intensity that is far more aggressive than most consumer protocols.

**Potential experiment signals:** Strength performance, body mass, training logs, soreness, recovery ratings

**Protocol takeaway:** Use it as a boundary case for heat dose, not as a default consumer protocol; most first tests should be milder and more adherable.
