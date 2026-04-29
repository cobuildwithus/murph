---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:mothertobaby-fever-hyperthermia-pregnancy-2025-02-01
slug: sources/dry-sauna/mothertobaby-fever-hyperthermia-pregnancy-2025-02-01
title: Fever / Hyperthermia
summary: MotherToBaby fact sheet explaining fever/hyperthermia in pregnancy and explicitly noting that hot tubs or saunas can cause hyperthermia.
status: draft
quality: usable
aliases:
  - MotherToBaby Fever/Hyperthermia
  - NCBI Bookshelf NBK582757 Fever / Hyperthermia
categories:
  - dry-sauna
relations:

  -
    type: related_protocol
    target: protocol_variant:dry-sauna/bryan-johnson-blueprint

  -
    type: parent_family
    target: experiment_family:dry-sauna
source:
  kind: web_page
  title: Fever / Hyperthermia
  authors: Organization of Teratology Information Specialists (MotherToBaby)
  year: 2025
  journal: MotherToBaby Fact Sheets / NCBI Bookshelf
  citation: MotherToBaby. Fever / Hyperthermia. MotherToBaby Fact Sheets. Published online February 2025. NCBI Bookshelf: NBK582757.
  url: https://www.ncbi.nlm.nih.gov/books/NBK582757/
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://www.ncbi.nlm.nih.gov/books/NBK582757/
  canonicalUrl: https://www.ncbi.nlm.nih.gov/books/NBK582757/
researchEvidence:
  designKind: other
  designLabel: Pregnancy exposure fact sheet
  participantCount: 0
  populationLabel: Pregnant people and breastfeeding people considering fever or hyperthermia exposure.
  durationLabel: Fact sheet; no intervention duration.
  aggregateRole: context
  cohortKey: mothertobaby-2025-fever-hyperthermia
  notes:
    - interventionOrExposure: Fever or hyperthermia, including extreme exercise, hot tubs, or saunas.
    - comparatorOrControl: No formal comparator.
    - endpoints: miscarriage uncertainty; neural tube defects before week 6; other early-pregnancy birth defects; preterm delivery and low birth weight context; breastfeeding context; male fertility context
    - effectEstimatesOrDirection: Guidance direction: hyperthermia can be concerning early in pregnancy; several studies report a small chance of neural tube defects with fever/hyperthermia before week 6, and sauna/hot tub use during pregnancy should be limited.
    - adverseEventsOrSafetyNotes: Potential early-pregnancy neural tube defects and other birth defects; some uncertainty and conflicting findings are explicitly noted.
    - limitations: Fact sheet based on research summaries, not a primary sauna trial.; Does not specify 93 °C sauna exposure.; Some outcomes remain uncertain or mixed.
    - populationMismatch: Pregnancy exposure safety source, not general adult protocol evidence.
    - directnessToProtocol: Indirect but explicit about sauna/hot tub hyperthermia risk.
evidenceBucket: Safety, heat illness, medications, pregnancy, alcohol, older-adult risk
whyItMatters: It directly names sauna as a possible hyperthermia source and preserves pregnancy uncertainty and caution.
potentialMurphEndpoints:
  - pregnancy status screen
  - hyperthermia symptoms
  - time in heat
  - core temperature if available
protocolTakeaway: Use as a pregnancy safety boundary: hot tub or sauna use during pregnancy should be limited and clinician guidance should take precedence.
murphTakeaway: Pregnancy is not an ordinary self-experiment context for high-heat sauna.
studyDesign: Teratology information fact sheet
modality: Pregnancy hyperthermia guidance including hot tubs and saunas
claimUse: safety-only
sourceFindings:

  -
    findingId: finding:mothertobaby-fever-hyperthermia-pregnancy-2025-02-01:sauna-hyperthermia-pregnancy
    sourceKey: source_artifact:mothertobaby-fever-hyperthermia-pregnancy-2025-02-01
    extractedFromArtifactId: art_mothertobaby_fever_hyperthermia_pregnancy_2025_02_01
    findingKind: safety
    population: Pregnant people, especially in early pregnancy.
    exposure: Fever or hyperthermia, including hot tubs or saunas.
    outcome: Early pregnancy concern and neural tube defect context.
    summary: MotherToBaby states that hot tubs or saunas might cause hyperthermia and that raised body temperature can be concerning in early pregnancy, especially if prolonged.
    evidenceUse:
      - safety

  -
    findingId: finding:mothertobaby-fever-hyperthermia-pregnancy-2025-02-01:ntd-week-six-uncertainty
    sourceKey: source_artifact:mothertobaby-fever-hyperthermia-pregnancy-2025-02-01
    extractedFromArtifactId: art_mothertobaby_fever_hyperthermia_pregnancy_2025_02_01
    findingKind: safety
    population: Babies of people with fever or hyperthermia during early pregnancy.
    exposure: Fever or hyperthermia before the 6th week of pregnancy.
    outcome: Neural tube defects and other birth defects.
    summary: MotherToBaby reports that several studies have found a small chance of neural tube defects after fever or hyperthermia before the 6th week of pregnancy, while also noting uncertainty and mixed findings for miscarriage and other birth defects.
    evidenceUse:
      - safety
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **Safety, heat illness, medications, pregnancy, alcohol, older-adult risk**.

**Findings:** MotherToBaby states that hot tubs or saunas might cause hyperthermia and that raised body temperature can be concerning in early pregnancy, especially if prolonged. MotherToBaby reports that several studies have found a small chance of neural tube defects after fever or hyperthermia before the 6th week of pregnancy, while also noting uncertainty and mixed findings for miscarriage and other birth defects.

**Why it matters:** It directly names sauna as a possible hyperthermia source and preserves pregnancy uncertainty and caution.

**Potential experiment signals:** pregnancy status screen, hyperthermia symptoms, time in heat, core temperature if available.

**Protocol takeaway:** Use as a pregnancy safety boundary: hot tub or sauna use during pregnancy should be limited and clinician guidance should take precedence.

**Claim use:** `safety-only`.
