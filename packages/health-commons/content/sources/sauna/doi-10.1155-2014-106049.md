---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1155-2014-106049
slug: sources/sauna/doi-10.1155-2014-106049
title: Cardiovascular and thermal response to dry-sauna exposure in healthy subjects
summary: Acute dry-sauna physiology study used to ground core-temperature, heart-rate, and thermal-load interpretation for high-temperature sauna protocols.
status: draft
quality: usable
categories:
  - sauna
  - study
  - experimental-physiology
relations:
  -
    type: parent_family
    target: experiment_family:dry-sauna
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/bryan-johnson-blueprint
source:
  kind: journal_article
  title: Cardiovascular and Thermal Response to Dry-Sauna Exposure in Healthy Subjects
  authors: Zalewski P, et al
  year: 2014
  journal: Physiology Journal
  citation: Zalewski P, Zawadka-Kunikowska M, Słomko J, Szrajda J, Klawe JJ, Tafil-Klawe M, Newton J. Cardiovascular and Thermal Response to Dry-Sauna Exposure in Healthy Subjects. Physiology Journal. 2014;2014:106049. doi:10.1155/2014/106049.
  doi: 10.1155/2014/106049
  url: https://onlinelibrary.wiley.com/doi/10.1155/2014/106049
evidenceBucket: Acute and mechanistic
whyItMatters: Gives direct dry-sauna context for interpreting acute thermal strain instead of treating air temperature and minutes as sufficient dose descriptors.
potentialMurphEndpoints:
  - session heart rate
  - core-temperature context
  - heat distress symptoms
  - recovery time
protocolTakeaway: Track session conditions, symptoms, and cooling context when interpreting high-temperature sauna exposure; duration alone is not a complete dose.
murphTakeaway: "Track session conditions, symptoms, and cooling context when interpreting high-temperature sauna exposure; duration alone is not a complete dose. It should shape dose, tolerance, endpoint choice, or safety context without promising a short-term wearable benefit."
studyDesign: Acute mechanistic study
modality: Dry sauna
finnishDrySaunaFocus: Yes
murphV1Priority: Medium
researchEvidence:
  designKind: acute_mechanistic
  designLabel: Acute dry-sauna physiology study
  participantCount: 9
  participantCountKind: reported
  populationLabel: Healthy young men
  durationLabel: Single 15-minute dry-sauna exposure at 100 C and 30-40 percent humidity
  aggregateRole: context
  cohortKey: zalewski-2014-dry-sauna-9
  notes:
    - Useful for dose interpretation and high-heat safety framing.
    - Added the reported sample size and exposure details so the high-temperature card is less ambiguous.
---

This source is included for **acute and mechanistic** sauna context.

**Findings:** Acute dry-sauna physiology study used to ground core-temperature, heart-rate, and thermal-load interpretation for high-temperature sauna protocols. Gives direct dry-sauna context for interpreting acute thermal strain instead of treating air temperature and minutes as sufficient dose descriptors.

**Why it matters:** It anchors dry-sauna dose interpretation in cardiovascular and thermal response rather than timer settings alone.

**Potential Murph endpoints/context:** session heart rate, core-temperature context, heat distress symptoms, recovery time

**Protocol takeaway:** For high-burden dry-sauna routines, log heat burden and symptoms rather than treating a time-and-temperature recipe as self-explanatory.
