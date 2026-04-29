---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1186-s13690-019-0368-7
slug: sources/daily-step-floor/doi-10.1186-s13690-019-0368-7
title: Effect of a pedometer-based walking challenge on increasing physical activity levels amongst hospital workers
summary: Hospital-worker pedometer challenge increased steps but did not show QoL gains.
status: draft
quality: usable
aliases:
- doi-10.1186-s13690-019-0368-7
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: journal_article
  title: Effect of a pedometer-based walking challenge on increasing physical activity levels amongst hospital workers
  authors: Abdulla S. Al-Mohannadi; Suzan Sayegh; Izzeldin Ibrahim; Ahmad Salman; Abdulaziz Farooq
  year: 2019
  journal: Archives of Public Health
  doi: 10.1186/s13690-019-0368-7
  url: https://pmc.ncbi.nlm.nih.gov/articles/PMC6757369
  citation: Al-Mohannadi AS, Sayegh S, Ibrahim I, Salman A, Farooq A. Effect of a pedometer-based walking challenge on increasing physical activity levels amongst hospital workers. Archives of Public Health. 2019;77:40. doi:10.1186/s13690-019-0368-7
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    pmcid: PMC6757369
    doi: 10.1186/s13690-019-0368-7
    titleHash: 7373e3699f6e06c1d1eb13834748b2d7072d62027331bf7d8e8248c963b983c7
    url: https://pmc.ncbi.nlm.nih.gov/articles/PMC6757369
  canonicalUrl: https://pmc.ncbi.nlm.nih.gov/articles/PMC6757369
researchEvidence:
  designKind: single_arm_trial
  designLabel: Three-month workplace pedometer walking challenge with pre/post assessment
  populationLabel: Hospital workers; broader pre/post questionnaire samples also reported
  durationLabel: 3 months
  cohortKey: daily-step-floor-doi-10.1186-s13690-019-0368-7
  participantCount: 54
  aggregateRole: primary
evidenceBucket: mental_health_sleep_qol
whyItMatters: Direct worksite step challenge preserving step increase with QoL/motivation limitations.
potentialMurphEndpoints:
- biomarker:daily-steps
- biomarker:quality-of-life
- biomarker:motivation
- biomarker:adherence
protocolTakeaway: Workplace challenges can raise steps, but QoL benefit and sustained motivation are not guaranteed.
murphTakeaway: Use as direct but mixed implementation evidence.
studyDesign: other
modality: daily-step / pedometer / walking
claimUse: supports-protocol
sourceFindings:
- findingId: finding:doi-10.1186-s13690-019-0368-7:mental-health-sleep-qol
  sourceKey: source_artifact:doi-10.1186-s13690-019-0368-7
  extractedFromArtifactId: art_doi_10_1186_s13690_019_0368_7
  findingKind: intervention_result
  population: Hospital workers; broader pre/post questionnaire samples also reported
  exposure: Pedometer-based workplace walking challenge with online step logging
  outcome: daily steps; self-reported physical activity; quality of life; sitting time; motivation
  summary: In a hospital-worker workplace challenge, a 54-person pedometer subsample increased average steps from 7,890 to 9,270/day, but quality of life did not differ and motivation maintenance was identified as challenging.
  evidenceUse:
  - efficacy
  - context
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **mental_health_sleep_qol**.

**Findings:** In a hospital-worker workplace challenge, a 54-person pedometer subsample increased average steps from 7,890 to 9,270/day, but quality of life did not differ and motivation maintenance was identified as challenging.

**Why it matters:** Direct worksite step challenge preserving step increase with QoL/motivation limitations.

**Potential experiment signals:** biomarker:daily-steps, biomarker:quality-of-life, biomarker:motivation, biomarker:adherence.

**Protocol takeaway:** Workplace challenges can raise steps, but QoL benefit and sustained motivation are not guaranteed.

**Claim use:** `supports-protocol`.

**Directness boundary:** This source is classified as `direct_protocol` for Daily Step Floor. Do not promote adjacent, observational, registry/protocol, or clinical-population findings into direct protocol claims.

**Safety/adverse events:** No adverse-event details were extracted from the open article summary in this batch.
