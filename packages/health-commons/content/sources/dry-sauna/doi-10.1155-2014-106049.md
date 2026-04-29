---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1155-2014-106049
slug: sources/dry-sauna/doi-10.1155-2014-106049
title: Cardiovascular and Thermal Response to Dry-Sauna Exposure in Healthy Subjects
summary: Small open-access dry-sauna physiology study in healthy young men measuring cardiovascular, autonomic, and thermal responses after 15 minutes at 100°C.
status: draft
quality: usable
aliases:
- Zalewski 2014 dry sauna cardiovascular thermal response
- DOI 10.1155/2014/106049 dry sauna healthy subjects
categories:
- dry-sauna
- cardiovascular-context
relations:
- type: related_protocol
  target: protocol_variant:dry-sauna/bryan-johnson-blueprint
- type: parent_family
  target: experiment_family:dry-sauna
source:
  kind: journal_article
  title: Cardiovascular and Thermal Response to Dry-Sauna Exposure in Healthy Subjects
  authors: Paweł Zalewski; Monika Zawadka-Kunikowska; Joanna Słomko; Justyna Szrajda; Jacek J. Klawe; Małgorzata Tafil-Klawe; Julia Newton
  year: 2014
  journal: Physiology Journal
  citation: Paweł Zalewski; Monika Zawadka-Kunikowska; Joanna Słomko; Justyna Szrajda; Jacek J. Klawe; Małgorzata Tafil-Klawe; Julia Newton. Cardiovascular and Thermal Response to Dry-Sauna Exposure in Healthy Subjects. Physiology Journal. 2014. doi:10.1155/2014/106049.
  doi: 10.1155/2014/106049
  url: https://onlinelibrary.wiley.com/doi/10.1155/2014/106049
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1155/2014/106049
    url: https://onlinelibrary.wiley.com/doi/10.1155/2014/106049
  canonicalUrl: https://doi.org/10.1155/2014/106049
researchEvidence:
  designKind: acute_mechanistic
  designLabel: Acute dry-sauna cardiovascular/autonomic/thermal physiology study
  participantCount: 9
  participantCountKind: reported
  populationLabel: Healthy young men, mean age about 26.7 years
  durationLabel: 15-minute sauna exposure with 6-hour follow-up measurements
  aggregateRole: primary
  cohortKey: doi-10-1155-2014-106049
evidenceBucket: Cardiovascular, autonomic, blood-pressure, and clinical sauna context
whyItMatters: Small open-access dry-sauna physiology study in healthy young men measuring cardiovascular, autonomic, and thermal responses after 15 minutes at 100°C.
potentialMurphEndpoints:
- core temperature
- heart-rate variability
- blood-pressure variability
- baroreflex sensitivity
- cardiovascular hemodynamics
protocolTakeaway: Use for acute thermal/cardiovascular mechanism and safety-dose context, not efficacy.
murphTakeaway: Use for acute thermal/cardiovascular mechanism and safety-dose context, not efficacy.
studyDesign: Acute dry-sauna cardiovascular/autonomic/thermal physiology study
modality: Dry sauna
populationMismatch: Young healthy men only; not women, older adults, or clinical populations.
directnessToBryanJohnsonSauna: same_mechanism
claimUseBoundary: Use for acute thermal/cardiovascular mechanism and safety-dose context, not efficacy.
interventionOrExposure: One 15-minute dry-sauna exposure at 100°C and 30-40% humidity
comparatorOrControl: Within-person measurements before sauna, after sauna, 3 hours after, and 6 hours after
endpoints:
- core temperature
- heart-rate variability
- blood-pressure variability
- baroreflex sensitivity
- cardiovascular hemodynamics
effectEstimateOrDirection: The study reported cardiovascular, autonomic, and thermal responses to a short high-temperature dry-sauna exposure in healthy men; it concluded homeostasis was not compromised in that small sample.
adverseEventsOrSafetyNotes: Extreme 100°C exposure is a strong thermal stimulus; findings are limited to screened healthy men.
limitations: Very small male-only sample; acute physiology; high-temperature 15-minute dose differs from many protocol variants.
claimUse: context-only
sourceFindings:
- findingId: finding:doi-10.1155-2014-106049-dry-sauna-cv-thermal
  sourceKey: source_artifact:doi-10.1155-2014-106049
  extractedFromArtifactId: art_doi_10_1155_2014_106049_html
  findingKind: mechanistic
  population: Healthy young men, mean age about 26.7 years
  exposure: One 15-minute dry-sauna exposure at 100°C and 30-40% humidity
  outcome: core temperature; heart-rate variability; blood-pressure variability; baroreflex sensitivity; cardiovascular hemodynamics
  summary: In 9 healthy young men, one 15-minute 100°C dry-sauna exposure produced measurable cardiovascular, autonomic, and thermal changes without reported homeostasis compromise in the screened sample.
  evidenceUse:
  - mechanism
  - measurement
  - safety
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **Cardiovascular, autonomic, blood-pressure, and clinical sauna context**.

**Findings:** In 9 healthy young men, one 15-minute 100°C dry-sauna exposure produced measurable cardiovascular, autonomic, and thermal changes without reported homeostasis compromise in the screened sample.

**Why it matters:** Small open-access dry-sauna physiology study in healthy young men measuring cardiovascular, autonomic, and thermal responses after 15 minutes at 100°C.

**Potential experiment signals:** core temperature; heart-rate variability; blood-pressure variability; baroreflex sensitivity; cardiovascular hemodynamics.

**Protocol takeaway:** Use for acute thermal/cardiovascular mechanism and safety-dose context, not efficacy.

**Claim use:** `context-only`.
