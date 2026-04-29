---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:va-cbti-sleep-hygiene-2025-02-01
slug: sources/caffeine-timing/va-cbti-sleep-hygiene-2025-02-01
title: 'Understanding CBT-I: Sleep Hygiene'
summary: VA sleep-hygiene material advises steering clear of caffeine later in the day, but sleep hygiene is only one CBT-I component and is not equivalent to CBT-I.
status: draft
quality: usable
aliases:
- 'Understanding CBT-I: Sleep Hygiene'
- source_artifact:va-cbti-sleep-hygiene-2025-02-01
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: guideline
  title: 'Understanding CBT-I: Sleep Hygiene'
  authors: U.S. Department of Veterans Affairs / Veterans Health Library
  year: 2025
  journal: Veterans Health Library
  citation: 'U.S. Department of Veterans Affairs. Understanding CBT-I: Sleep Hygiene. February 1, 2025. https://www.mentalhealth.va.gov/coe/cih-visn2/Documents/Patient_Education_Handouts/Understanding_CBTI-Sleep_Hygiene_Version_3.pdf.'
  url: https://www.mentalhealth.va.gov/coe/cih-visn2/Documents/Patient_Education_Handouts/Understanding_CBTI-Sleep_Hygiene_Version_3.pdf
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 1618dc69bda53258a369151d62dd923eafe92c4021674ecc5d62b47750640cf8
    url: https://www.mentalhealth.va.gov/coe/cih-visn2/Documents/Patient_Education_Handouts/Understanding_CBTI-Sleep_Hygiene_Version_3.pdf
  canonicalUrl: https://www.mentalhealth.va.gov/coe/cih-visn2/Documents/Patient_Education_Handouts/Understanding_CBTI-Sleep_Hygiene_Version_3.pdf
researchEvidence:
  designKind: guideline
  designLabel: VA CBT-I patient education / sleep hygiene guidance
  populationLabel: Veterans/patients receiving sleep-hygiene education.
  durationLabel: No intervention follow-up.
  aggregateRole: context
  cohortKey: va-cbti-sleep-hygiene-2025-02-01-veterans-patients-receiving-sleep-hygiene-education
  notes:
  - 'Intervention or exposure: Sleep-hygiene advice including steering clear of caffeine later in the day.'
  - 'Comparator or control: Not applicable.'
  - 'Endpoints: Sleep hygiene education and insomnia-management component boundaries.'
  - 'Effect or direction: Patient education guidance only; no original effect estimate.'
  - 'Safety notes: General stimulant/sleep caution.'
  - 'Limitations: The supplied VA PDF URL returned a 404 during extraction; an accessible VA Veterans Health Library page with the same dated topic was used for content context.'
  - 'Population mismatch: Patient education context, not a protocol trial.'
  - 'Directness to target protocol: General guideline and claim-boundary context.'
evidenceBucket: external_protocol_claims_and_guidelines
whyItMatters: 'It is an important boundary source: caffeine advice appears in sleep hygiene, but sleep hygiene alone should not be conflated with full CBT-I.'
potentialMurphEndpoints:
- Sleep hygiene adherence
- Sleep onset
- CBT-I component boundaries
protocolTakeaway: 'Context-only: cite to separate caffeine-curfew advice from comprehensive CBT-I claims.'
murphTakeaway: A caffeine curfew is a sleep-hygiene behavior, not a substitute for CBT-I when insomnia requires care.
studyDesign: guideline
modality: patient-education-guidance
claimUse: context-only
sourceFindings:
- findingId: finding:va-cbti-sleep-hygiene-2025-02-01-caffeine-sleep-hygiene-not-cbti
  sourceKey: source_artifact:va-cbti-sleep-hygiene-2025-02-01
  extractedFromArtifactId: art_va_cbti_sleep_hygiene_2025_02_01_html
  findingKind: context
  population: Veterans/patients receiving sleep-hygiene education.
  exposure: VA sleep-hygiene guidance including late-day caffeine avoidance.
  outcome: Boundary between sleep hygiene advice and full CBT-I.
  summary: VA sleep-hygiene education includes late-day caffeine avoidance, but it should be treated as a sleep-hygiene component rather than evidence for full CBT-I or caffeine-curfew efficacy.
  evidenceUse:
  - context
  - safety
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **external_protocol_claims_and_guidelines**.

**Findings:** VA sleep-hygiene education includes late-day caffeine avoidance, but it should be treated as a sleep-hygiene component rather than evidence for full CBT-I or caffeine-curfew efficacy.

**Why it matters:** It is an important boundary source: caffeine advice appears in sleep hygiene, but sleep hygiene alone should not be conflated with full CBT-I.

**Potential experiment signals:** Sleep hygiene adherence; Sleep onset; CBT-I component boundaries.

**Protocol takeaway:** Context-only: cite to separate caffeine-curfew advice from comprehensive CBT-I claims.

**Claim use:** `context-only`.
