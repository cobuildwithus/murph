---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1016-j.jadr.2023.100497"
slug: "sources/morning-light-exposure/doi-10.1016-j.jadr.2023.100497"
title: "Hospital room exposure to daylight and clinical improvement in unipolar depressed inpatients"
summary: "Hospital room exposure to daylight and clinical improvement in unipolar depressed inpatients is included as clinical_light_therapy_device_boundaries evidence for clinical light-therapy/device-treatment boundaries. A recent inpatient room-orientation study found no clear daylight-room advantage on HAMD-17 improvement."
status: "draft"
quality: "usable"
aliases:
  - "Hospital room exposure to daylight and clinical improvement in unipolar depressed inpatients"
  - "doi-10.1016-j.jadr.2023.100497"
categories:
  - "morning-light-exposure"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:morning-light-exposure/morning-outdoor-light-exposure"
  -
    type: "parent_family"
    target: "experiment_family:morning-light-exposure"
source:
  kind: "journal_article"
  title: "Hospital room exposure to daylight and clinical improvement in unipolar depressed inpatients"
  authors: "Anthony Cheniara; Kenneth Chappell; Florence Gressier; Laurent Becquemont; Emmanuelle Corruble; Romain Colle"
  year: 2023
  journal: "Journal of Affective Disorders Reports"
  citation: "Cheniara A, Chappell K, Gressier F, Becquemont L, Corruble E, Colle R. Hospital room exposure to daylight and clinical improvement in unipolar depressed inpatients. Journal of Affective Disorders Reports. 2023;12:100497. doi:10.1016/j.jadr.2023.100497."
  doi: "10.1016/j.jadr.2023.100497"
  url: "https://doi.org/10.1016/j.jadr.2023.100497"
researchEvidence:
  designKind: "prospective_cohort"
  designLabel: "Nested case-control inpatient daylight-room analysis"
  participantCount: 44
  participantCountKind: "reported"
  populationLabel: "Unipolar depressed inpatients with major depressive episode in major depressive disorder, treated with venlafaxine and hospitalized at least 1 month."
  durationLabel: "1 month inpatient clinical improvement assessment"
  aggregateRole: "primary"
  cohortKey: "cohort:doi-10.1016-j.jadr.2023.100497"
evidenceBucket: "clinical_light_therapy_device_boundaries"
whyItMatters: "Important null boundary evidence against overgeneralizing earlier sunny-room findings."
potentialMurphEndpoints:
  - "HAMD-17 percent improvement"
  - "room orientation"
  - "season subgroup"
protocolTakeaway: "Use as context that hospital room daylight findings are not uniformly positive."
murphTakeaway: "A recent inpatient room-orientation study found no clear daylight-room advantage on HAMD-17 improvement."
studyDesign: "cohort"
modality: "hospital-room daylight orientation exposure"
claimUse: "context-only"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
---

This source is included for **clinical_light_therapy_device_boundaries**.

**Findings:** Population: Unipolar depressed inpatients with major depressive episode in major depressive disorder, treated with venlafaxine and hospitalized at least 1 month. Intervention/exposure: South- or east-facing hospital room daylight exposure. Comparator/control: North- or west-facing hospital room daylight exposure. Duration/follow-up: 1 month inpatient clinical improvement assessment Endpoints: HAMD-17 improvement, room orientation/daylight exposure. Effect/direction: HAMD-17 improvement was 56.8% in South/East rooms versus 65.6% in North/West rooms (p=0.21); no association was found in East vs West, South vs North, or winter vs summer subgroup comparisons. Safety/adverse events: No adverse events were extracted.

**Why it matters:** Important null boundary evidence against overgeneralizing earlier sunny-room findings.

**Potential experiment signals:** HAMD-17 percent improvement, room orientation, season subgroup

**Protocol takeaway:** Use as context that hospital room daylight findings are not uniformly positive.

**Directness and boundaries:** Directness is `clinical_supervised` with protocol-evidence scope `clinical_supervised`. Population mismatch: Unipolar depressed inpatients receiving venlafaxine, not general outdoor-light users.

**Limitations and uncertainty:** Limited sample; non-randomized room exposure; inpatient venlafaxine-treated population; not outdoor morning exposure.

**Claim use:** `context-only`.
