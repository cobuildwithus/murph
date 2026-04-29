---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:who-semen-manual-2021-07-27
slug: sources/dry-sauna/who-semen-manual-2021-07-27
title: WHO laboratory manual for the examination and processing of human semen, 6th ed
summary: The WHO semen manual is a measurement-standard source for examination and processing of human semen; it does not evaluate sauna or cooling interventions.
status: draft
quality: usable
aliases:
- WHO laboratory manual for the examination and processing of human semen, 6th ed
categories:
- dry-sauna
- fertility-safety
- semen-analysis
relations:
- type: related_protocol
  target: protocol_variant:dry-sauna/bryan-johnson-blueprint
- type: parent_family
  target: experiment_family:dry-sauna
source:
  kind: guideline
  title: WHO laboratory manual for the examination and processing of human semen, 6th ed
  authors: World Health Organization
  year: 2021
  journal: World Health Organization
  url: https://www.who.int/publications/i/item/9789240030787
  citation: World Health Organization. WHO laboratory manual for the examination and processing of human semen, 6th ed. World Health Organization. 2021. https://www.who.int/publications/i/item/9789240030787
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    url: https://www.who.int/publications/i/item/9789240030787
  canonicalUrl: https://www.who.int/publications/i/item/9789240030787
researchEvidence:
  designKind: guideline
  designLabel: guideline
  populationLabel: Clinical and research semen-analysis laboratories
  durationLabel: Not extracted
  aggregateRole: synthesis
  cohortKey: dry-sauna-fertility-semen-cooling-context
  notes:
  - Participant count was not extracted from available metadata for this batch.
  - 'Limitations: Manual/guideline; not a protocol-efficacy source.'
  - 'Population/protocol mismatch: Measurement context only.'
evidenceBucket: Fertility, semen, and groin-cooling safety/context
whyItMatters: Measurement-standard anchor for semen endpoints mentioned in protocol-owner claims and heat-safety studies.
potentialMurphEndpoints:
- semen-analysis
- fertility-safety
protocolTakeaway: Use for how semen-analysis endpoints should be defined and interpreted.
murphTakeaway: Semen outcomes should be measured with standardized lab procedures rather than informal proxy claims.
studyDesign: guideline
modality: semen-analysis measurement standard
claimUse: safety-only
directnessToBryanJohnsonSauna: measurement_context
claimUseBoundary: Use for how semen-analysis endpoints should be defined and interpreted.
sourceFindings:
- findingId: finding:who-semen-manual-2021-07-27-batch007-fertility-safety
  sourceKey: source_artifact:who-semen-manual-2021-07-27
  extractedFromArtifactId: art-who-semen-manual-2021-07-27-html
  findingKind: measurement_validation
  population: Clinical and research semen-analysis laboratories
  exposure: WHO standardized semen examination and processing procedures
  outcome: Semen-analysis methods and interpretive context
  summary: The WHO semen manual is a measurement-standard source for examination and processing of human semen; it does not evaluate sauna or cooling interventions.
  evidenceUse:
  - measurement
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **Fertility, semen, and groin-cooling safety/context**.

**Findings:** The WHO semen manual is a measurement-standard source for examination and processing of human semen; it does not evaluate sauna or cooling interventions.

**Why it matters:** Measurement-standard anchor for semen endpoints mentioned in protocol-owner claims and heat-safety studies.

**Potential experiment signals:** semen-analysis, fertility-safety.

**Protocol takeaway:** Use for how semen-analysis endpoints should be defined and interpreted.

**Claim use:** `safety-only`.

**Directness and limitations:** Measurement context only. Manual/guideline; not a protocol-efficacy source.
