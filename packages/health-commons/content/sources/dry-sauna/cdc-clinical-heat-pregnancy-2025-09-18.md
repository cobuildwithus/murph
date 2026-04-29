---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:cdc-clinical-heat-pregnancy-2025-09-18
slug: sources/dry-sauna/cdc-clinical-heat-pregnancy-2025-09-18
title: Clinical Overview of Heat and Pregnancy
summary: CDC clinical guidance identifying pregnancy as a heat-risk state and supporting pregnancy-specific exclusion or clinician-review language for high-heat sauna.
status: draft
quality: usable
aliases:
  - CDC Clinical Overview of Heat and Pregnancy
  - CDC heat and pregnant women 2025
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
  title: Clinical Overview of Heat and Pregnancy
  authors: Centers for Disease Control and Prevention
  year: 2025
  journal: CDC Heat Health
  citation: Centers for Disease Control and Prevention. Clinical Overview of Heat and Pregnancy. Sept. 18, 2025.
  url: https://www.cdc.gov/heat-health/hcp/clinical-overview/heat-and-pregnant-women.html
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://www.cdc.gov/heat-health/hcp/clinical-overview/heat-and-pregnant-women.html
  canonicalUrl: https://www.cdc.gov/heat-health/hcp/clinical-overview/heat-and-pregnant-women.html
researchEvidence:
  designKind: guideline
  designLabel: CDC clinical heat-health guidance
  participantCount: 0
  populationLabel: Pregnant women and pregnant patients exposed to heat.
  durationLabel: Guidance; notes that even one day of high heat may increase risk.
  aggregateRole: context
  cohortKey: cdc-2025-heat-pregnancy
  notes:
    - interventionOrExposure: Heat exposure during pregnancy, including hot environments and medication interactions.
    - comparatorOrControl: No formal comparator.
    - endpoints: maternal heat illness; hypertensive disorders of pregnancy; preterm birth; stillbirth; low birthweight; birth defects
    - effectEstimatesOrDirection: Guidance direction: heat exposure can harm pregnant patients and is associated with adverse pregnancy outcomes; risk rises with higher temperatures and longer exposure.
    - adverseEventsOrSafetyNotes: Heat harms during pregnancy, preterm birth, stillbirth, low birthweight, first-trimester birth-defect risk, and medication-related heat sensitivity.
    - limitations: Environmental heat guidance, not a sauna trial.; Does not quantify risk for 93 °C sauna.
    - populationMismatch: Pregnancy-specific safety boundary rather than general adult protocol efficacy.
    - directnessToProtocol: Indirect but highly relevant as a safety exclusion for deliberate heat exposure.
evidenceBucket: Safety, heat illness, medications, pregnancy, alcohol, older-adult risk
whyItMatters: It creates a current, conservative pregnancy safety boundary for a high-heat external protocol.
potentialMurphEndpoints:
  - pregnancy status screen
  - heat illness symptoms
  - hydration status
  - blood pressure or hypertensive-disorder context
protocolTakeaway: Pregnancy should be treated as a medical-review or exclusion boundary for Bryan Johnson Sauna; do not use this source for efficacy claims.
murphTakeaway: Any high-heat protocol needs a pregnancy safety warning that defers to clinical care.
studyDesign: Clinical public-health guidance
modality: Environmental heat guidance applied as sauna safety boundary
claimUse: safety-only
sourceFindings:

  -
    findingId: finding:cdc-clinical-heat-pregnancy-2025-09-18:pregnancy-heat-adverse-outcomes
    sourceKey: source_artifact:cdc-clinical-heat-pregnancy-2025-09-18
    extractedFromArtifactId: art_cdc_clinical_heat_pregnancy_2025_09_18
    findingKind: safety
    population: Pregnant women and pregnant patients.
    exposure: Heat exposure during pregnancy.
    outcome: Pregnancy complications and adverse pregnancy outcomes.
    summary: CDC guidance states that heat can harm pregnant women during any trimester and that heat exposure can lead to pregnancy complications and adverse outcomes, with risk potentially increasing after as little as one day of high heat.
    evidenceUse:
      - safety

  -
    findingId: finding:cdc-clinical-heat-pregnancy-2025-09-18:pregnancy-medication-heat-sensitivity
    sourceKey: source_artifact:cdc-clinical-heat-pregnancy-2025-09-18
    extractedFromArtifactId: art_cdc_clinical_heat_pregnancy_2025_09_18
    findingKind: safety
    population: Pregnant patients using prescription or over-the-counter medications.
    exposure: Heat exposure plus medications that can impair heat tolerance or fluid balance.
    outcome: Heat sensitivity and heat illness risk.
    summary: CDC guidance recommends reviewing commonly prescribed medications in pregnancy, including antihistamines and antihypertensive medications, because medications and heat can interact and may increase heat sensitivity.
    evidenceUse:
      - safety
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **Safety, heat illness, medications, pregnancy, alcohol, older-adult risk**.

**Findings:** CDC guidance states that heat can harm pregnant women during any trimester and that heat exposure can lead to pregnancy complications and adverse outcomes, with risk potentially increasing after as little as one day of high heat. CDC guidance recommends reviewing commonly prescribed medications in pregnancy, including antihistamines and antihypertensive medications, because medications and heat can interact and may increase heat sensitivity.

**Why it matters:** It creates a current, conservative pregnancy safety boundary for a high-heat external protocol.

**Potential experiment signals:** pregnancy status screen, heat illness symptoms, hydration status, blood pressure or hypertensive-disorder context.

**Protocol takeaway:** Pregnancy should be treated as a medical-review or exclusion boundary for Bryan Johnson Sauna; do not use this source for efficacy claims.

**Claim use:** `safety-only`.
