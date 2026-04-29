---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:isrctn-ISRCTN94041896
slug: sources/dry-sauna/isrctn-ISRCTN94041896
title: A pilot randomised study of the effects of the FertilMate - a scrotal cooling patch on male fertility
summary: The ISRCTN record registers a pilot randomized study of the FertilMate scrotal-cooling patch on male fertility; no outcome results were extracted from the registry record for this batch.
status: draft
quality: usable
aliases:
- ISRCTN94041896
- A pilot randomised study of the effects of the FertilMate - a scrotal cooling patch on male fertility
categories:
- dry-sauna
- fertility-safety
- semen-analysis
- groin-cooling
relations:
- type: related_protocol
  target: protocol_variant:dry-sauna/bryan-johnson-blueprint
- type: parent_family
  target: experiment_family:dry-sauna
source:
  kind: other
  title: A pilot randomised study of the effects of the FertilMate - a scrotal cooling patch on male fertility
  authors: ISRCTN Registry
  year: 2012
  journal: ISRCTN Registry
  url: https://www.isrctn.com/ISRCTN94041896
  citation: ISRCTN Registry. A pilot randomised study of the effects of the FertilMate - a scrotal cooling patch on male fertility. ISRCTN Registry. 2012. https://www.isrctn.com/ISRCTN94041896
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: ISRCTN94041896
    url: https://www.isrctn.com/ISRCTN94041896
  canonicalUrl: https://www.isrctn.com/ISRCTN94041896
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: rct
  populationLabel: Men planned or enrolled for a pilot scrotal-cooling patch fertility trial
  durationLabel: Pilot randomized study registry record; outcomes not extracted
  aggregateRole: context
  cohortKey: dry-sauna-fertility-semen-cooling-context
  notes:
  - Participant count was not extracted from available metadata for this batch.
  - 'Limitations: Registry/protocol record; no extracted results; non-sauna patch intervention.'
  - 'Population/protocol mismatch: Adjacent planned cooling intervention, not sauna-session groin icing.'
evidenceBucket: Fertility, semen, and groin-cooling safety/context
whyItMatters: Useful for identifying controlled scrotal-cooling research without treating registry entries as outcomes.
potentialMurphEndpoints:
- groin-cooling-boundary
- semen-analysis
protocolTakeaway: Use as trial-registry context only; do not claim efficacy from registration.
murphTakeaway: Can help flag the need for controlled cooling evidence and outcome retrieval.
studyDesign: rct
modality: trial registry / scrotal cooling patch
claimUse: safety-only
directnessToBryanJohnsonSauna: adjacent_variant
claimUseBoundary: Use as trial-registry context only; do not claim efficacy from registration.
sourceFindings:
- findingId: finding:isrctn-ISRCTN94041896-batch007-fertility-safety
  sourceKey: source_artifact:isrctn-ISRCTN94041896
  extractedFromArtifactId: art-isrctn-ISRCTN94041896-registry
  findingKind: context
  population: Men planned or enrolled for a pilot scrotal-cooling patch fertility trial
  exposure: FertilMate scrotal cooling patch
  outcome: Registered fertility/semen endpoints; results not extracted
  summary: The ISRCTN record registers a pilot randomized study of the FertilMate scrotal-cooling patch on male fertility; no outcome results were extracted from the registry record for this batch.
  evidenceUse:
  - context
  - adjacent_variant
murphV1Priority: Low
pdfRightsStatus: unknown
---

This source is included for **Fertility, semen, and groin-cooling safety/context**.

**Findings:** The ISRCTN record registers a pilot randomized study of the FertilMate scrotal-cooling patch on male fertility; no outcome results were extracted from the registry record for this batch.

**Why it matters:** Useful for identifying controlled scrotal-cooling research without treating registry entries as outcomes.

**Potential experiment signals:** groin-cooling-boundary, semen-analysis.

**Protocol takeaway:** Use as trial-registry context only; do not claim efficacy from registration.

**Claim use:** `safety-only`.

**Directness and limitations:** Adjacent planned cooling intervention, not sauna-session groin icing. Registry/protocol record; no extracted results; non-sauna patch intervention.
