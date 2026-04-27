---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-opioid-benzodiazepine-cns-depressants-alcohol-2016-08-31
slug: sources/alcohol-abstinence/fda-opioid-benzodiazepine-cns-depressants-alcohol-2016-08-31
title: New Safety Measures Announced for Opioid Analgesics, Prescription Opioid Cough Products, and Benzodiazepines
summary: Regulatory boxed-warning source for opioid/benzodiazepine/CNS depressant plus alcohol risk language.
status: draft
quality: usable
aliases:
- source_artifact:fda-opioid-benzodiazepine-cns-depressants-alcohol-2016-08-31
- fda-opioid-benzodiazepine-cns-depressants-alcohol-2016-08-31
- candidate:medications-pregnancy-liver-mental-health:005
categories:
- alcohol-abstinence
relations:
-
  type: related_protocol
  target: protocol_variant:alcohol-abstinence/short-term-alcohol-abstinence
-
  type: parent_family
  target: experiment_family:alcohol-abstinence
source:
  kind: web_page
  title: New Safety Measures Announced for Opioid Analgesics, Prescription Opioid Cough Products, and Benzodiazepines
  authors: U.S. Food and Drug Administration
  year: 2016
  journal: FDA Drug Safety and Availability
  citation: U.S. Food and Drug Administration. New Safety Measures Announced for Opioid Analgesics, Prescription Opioid Cough Products, and Benzodiazepines. FDA Drug Safety and Availability. 2016
  url: https://www.fda.gov/drugs/information-drug-class/new-safety-measures-announced-opioid-analgesics-prescription-opioid-cough-products-and
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 8c5d2ecd10dd4f94a854aa9614a1057f2d154089b87301dab905cf107e174b95
    url: https://www.fda.gov/drugs/information-drug-class/new-safety-measures-announced-opioid-analgesics-prescription-opioid-cough-products-and
  canonicalUrl: https://www.fda.gov/drugs/information-drug-class/new-safety-measures-announced-opioid-analgesics-prescription-opioid-cough-products-and
researchEvidence:
  designKind: other
  designLabel: Other / registry / case-report context
  populationLabel: Patients using opioid analgesics, opioid cough products, benzodiazepines, or other CNS depressants
  durationLabel: Regulatory safety communication; no challenge duration.
  aggregateRole: primary
  cohortKey: fda-opioid-benzodiazepine-cns-depressants-alcohol-2016-08-31
  notes:
  - Protocol-specific interpretation belongs to standalone evidence appraisal records, not source-page efficacy fields.
  - Directness and population mismatch are preserved for protocol synthesis.
evidenceBucket: medication, pregnancy, liver disease, and mental-health safety boundary
whyItMatters: Regulatory boxed-warning source for opioid/benzodiazepine/CNS depressant plus alcohol risk language.
potentialMurphEndpoints:
- safety
- medication interaction
protocolTakeaway: Screen for opioid, benzodiazepine, sedative, and CNS depressant use; route high-risk medication combinations to clinician advice rather than challenge framing.
murphTakeaway: Screen for opioid, benzodiazepine, sedative, and CNS depressant use; route high-risk medication combinations to clinician advice rather than challenge framing.
studyDesign: Other / registry / case-report context
modality: Opioid/benzodiazepine/CNS depressant safety warning
claimUse: safety-only
sourceFindings:
-
  findingId: finding:alcohol-abstinence/fda-opioid-benzodiazepine-cns-depressants-alcohol-2016-08-31
  sourceKey: source_artifact:fda-opioid-benzodiazepine-cns-depressants-alcohol-2016-08-31
  extractedFromArtifactId: art_fda-opioid-benzodiazepine-cns-depressants-alcohol-2016-08-31
  findingKind: safety
  population: Patients using opioid analgesics, opioid cough products, benzodiazepines, or other CNS depressants
  exposure: Combined use of opioids with benzodiazepines or other CNS depressants, including alcohol
  outcome: safety, medication interaction
  summary: FDA safety communication identifies combined opioids, benzodiazepines, other CNS depressants, and alcohol as a serious safety risk; this supports medication-interaction screening before short-term abstinence protocols.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
interventionOrExposure: Combined use of opioids with benzodiazepines or other CNS depressants, including alcohol
comparatorOrControl: Not applicable.
durationOrFollowUp: Regulatory safety communication; no challenge duration.
endpoints:
- safety
- medication interaction
effectEstimatesOrDirection: No challenge efficacy estimate. FDA required strong warnings for serious risks and death with combined opioid, benzodiazepine, other CNS depressant, and alcohol exposure.
adverseEventsOrSafetyNotes: Combined opioid, benzodiazepine, CNS depressant, and alcohol exposure is a high-risk medication-interaction boundary.
limitations:
- Not a direct trial of self-guided 7-, 14-, or 30-day alcohol-free variants.
- Use is limited to safety, clinical context, measurement context, or adjacent-variant interpretation.
populationMismatch: Patients using opioid analgesics, opioid cough products, benzodiazepines, or other CNS depressants differs from generally healthy community participants considering a short alcohol-free challenge.
directnessToProtocol: clinical_supervised
claimUseBoundary: Safety/context boundary. This source should not be promoted into direct protocol efficacy claims unless a future synthesis explicitly labels it as adjacent evidence.
artifactCandidates:
- art_fda-opioid-benzodiazepine-cns-depressants-alcohol-2016-08-31
---


This source is included for **Medication, pregnancy, liver disease, and mental-health safety boundaries (part 1)**.

**Findings:** FDA safety communication identifies combined opioids, benzodiazepines, other CNS depressants, and alcohol as a serious safety risk; this supports medication-interaction screening before short-term abstinence protocols.

**Why it matters:** Regulatory boxed-warning source for opioid/benzodiazepine/CNS depressant plus alcohol risk language.

**Potential experiment signals:** safety, medication interaction.

**Protocol takeaway:** Screen for opioid, benzodiazepine, sedative, and CNS depressant use; route high-risk medication combinations to clinician advice rather than challenge framing.

**Claim use:** `safety-only`.
