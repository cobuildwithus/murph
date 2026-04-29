---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:dailymed-metamucil-psyllium-label-2026-04-26"
slug: "sources/psyllium-husk/dailymed-metamucil-psyllium-label-2026-04-26"
title: "Label: Metamucil Therapy for Regularity - psyllium husk powder"
summary: "DailyMed Drug Facts label for Metamucil psyllium husk powder documenting serving content plus choking, allergy, liquid, medication-spacing, and minor-bloating warnings."
status: "draft"
quality: "usable"
aliases:
  - "Label: Metamucil Therapy for Regularity - psyllium husk powder"
categories:
  - "psyllium-husk"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:psyllium-husk"
source:
  kind: "web_page"
  title: "Label: Metamucil Therapy for Regularity - psyllium husk powder"
  authors: "DailyMed / U.S. National Library of Medicine"
  journal: "DailyMed"
  url: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=a9824f73-5ea2-4a65-a926-3a57561441b8"
  citation: "DailyMed / U.S. National Library of Medicine. Label: Metamucil Therapy for Regularity - psyllium husk powder. DailyMed. https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=a9824f73-5ea2-4a65-a926-3a57561441b8"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    url: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=a9824f73-5ea2-4a65-a926-3a57561441b8"
  canonicalUrl: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=a9824f73-5ea2-4a65-a926-3a57561441b8"
researchEvidence:
  designKind: "other"
  designLabel: "other"
  populationLabel: "OTC psyllium users, including people with swallowing difficulty or medication-use questions"
  durationLabel: "Current consumer label; no intervention follow-up."
  aggregateRole: "primary"
  cohortKey: "cohort:dailymed-metamucil-psyllium-label-2026-04-26:source-population"
  notes:
    - "Batch batch-005 extraction; claim use safety-only."
    - "Limitations: Single branded product label.; Label language may change over time."
    - "Population mismatch: Label audience is broad OTC regularity users, not specifically adults testing LDL-C response."
evidenceBucket: "Safety, adverse events, and drug-interaction boundaries"
whyItMatters: "Primary U.S. safety-label source for choking, allergy, fluid, and medication-spacing boundaries."
potentialMurphEndpoints:
  - "safety"
  - "adverse events"
  - "medication context"
  - "pregnancy/lactation"
protocolTakeaway: "A consumer protocol should operationalize the label: mix promptly with 8 oz liquid, avoid use with swallowing difficulty, and separate oral medicines."
murphTakeaway: "Murph extraction should preserve this source as safety/context evidence and avoid promoting it into a direct LDL-C claim."
studyDesign: "other"
modality: "oral psyllium husk / ispaghula husk safety, tolerability, label, or adjacent context"
claimUse: "safety-only"
sourceFindings:

  -
    findingId: "finding:dailymed-metamucil-psyllium-label-2026-04-26-metamucil-serving"
    sourceKey: "source_artifact:dailymed-metamucil-psyllium-label-2026-04-26"
    extractedFromArtifactId: "art_dailymed_metamucil_psyllium_label_2026_04_26"
    findingKind: "context"
    population: "OTC Metamucil users."
    exposure: "One Metamucil psyllium powder packet."
    outcome: "Labeled active psyllium amount."
    summary: "The label lists psyllium husk 3.4 g per 5.8 g packet."
    evidenceUse:
      - "context"
      - "safety"
  -
    findingId: "finding:dailymed-metamucil-psyllium-label-2026-04-26-metamucil-liquid-choking"
    sourceKey: "source_artifact:dailymed-metamucil-psyllium-label-2026-04-26"
    extractedFromArtifactId: "art_dailymed_metamucil_psyllium_label_2026_04_26"
    findingKind: "safety"
    population: "OTC psyllium users, especially people with swallowing difficulty."
    exposure: "Psyllium husk powder mixed in liquid."
    outcome: "Choking and esophageal blockage warnings."
    summary: "The label warns that inadequate fluid can make the product swell and block the throat or esophagus and directs users to mix with at least 8 oz of liquid and drink promptly."
    evidenceUse:
      - "safety"
  -
    findingId: "finding:dailymed-metamucil-psyllium-label-2026-04-26-metamucil-allergy-med-spacing"
    sourceKey: "source_artifact:dailymed-metamucil-psyllium-label-2026-04-26"
    extractedFromArtifactId: "art_dailymed_metamucil_psyllium_label_2026_04_26"
    findingKind: "safety"
    population: "OTC psyllium users taking other medicines or with psyllium sensitivity."
    exposure: "Psyllium husk powder exposure and coadministration with oral medicines."
    outcome: "Allergic reaction and drug-absorption warnings."
    summary: "The label includes an allergy alert and tells users to take other drugs at least 2 hours before or after the laxative because laxatives may affect how other drugs work."
    evidenceUse:
      - "safety"
  -
    findingId: "finding:dailymed-metamucil-psyllium-label-2026-04-26-metamucil-bloating-start-low"
    sourceKey: "source_artifact:dailymed-metamucil-psyllium-label-2026-04-26"
    extractedFromArtifactId: "art_dailymed_metamucil_psyllium_label_2026_04_26"
    findingKind: "safety"
    population: "New or dose-escalating psyllium users."
    exposure: "Starting psyllium powder."
    outcome: "Minor bloating and dose-titration advice."
    summary: "The label notes minor bloating may occur and suggests starting with one serving per day before gradual increase."
    evidenceUse:
      - "safety"
      - "context"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
interventionOrExposure: "Psyllium husk powder drug facts label"
comparatorOrControl: "Not applicable or not extracted for this safety/context source."
durationOrFollowUp: "Current consumer label; no intervention follow-up."
endpoints:
  - "safety"
  - "adverse events"
  - "medication context"
  - "pregnancy/lactation"
adverseEventsOrSafetyNotes:
  - "The label warns that inadequate fluid can make the product swell and block the throat or esophagus and directs users to mix with at least 8 oz of liquid and drink promptly."
  - "The label includes an allergy alert and tells users to take other drugs at least 2 hours before or after the laxative because laxatives may affect how other drugs work."
  - "The label notes minor bloating may occur and suggests starting with one serving per day before gradual increase."
limitations:
  - "Single branded product label."
  - "Label language may change over time."
populationMismatch: "Label audience is broad OTC regularity users, not specifically adults testing LDL-C response."
directnessToProtocol: "general_guideline"
---
This source is included for **Safety, adverse events, and drug-interaction boundaries**.

**Findings:**

- `finding:dailymed-metamucil-psyllium-label-2026-04-26-metamucil-serving` — The label lists psyllium husk 3.4 g per 5.8 g packet.
- `finding:dailymed-metamucil-psyllium-label-2026-04-26-metamucil-liquid-choking` — The label warns that inadequate fluid can make the product swell and block the throat or esophagus and directs users to mix with at least 8 oz of liquid and drink promptly.
- `finding:dailymed-metamucil-psyllium-label-2026-04-26-metamucil-allergy-med-spacing` — The label includes an allergy alert and tells users to take other drugs at least 2 hours before or after the laxative because laxatives may affect how other drugs work.
- `finding:dailymed-metamucil-psyllium-label-2026-04-26-metamucil-bloating-start-low` — The label notes minor bloating may occur and suggests starting with one serving per day before gradual increase.

**Why it matters:** Primary U.S. safety-label source for choking, allergy, fluid, and medication-spacing boundaries.

**Potential experiment signals:**

- safety
- adverse events
- medication context
- pregnancy/lactation

**Protocol takeaway:** A consumer protocol should operationalize the label: mix promptly with 8 oz liquid, avoid use with swallowing difficulty, and separate oral medicines.

**Limitations and population mismatch:** Single branded product label.; Label language may change over time. Population mismatch: Label audience is broad OTC regularity users, not specifically adults testing LDL-C response.

**Claim use:** `safety-only`.
