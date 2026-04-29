---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct03433222-2026-04-24
slug: sources/skin-photobiomodulation/clinicaltrials-nct03433222-2026-04-24
title: Phase 1 Study of High Fluence LED-Red Light in Fitzpatrick Skin Types I to III
summary: The registry documents Fitzpatrick I-III high-fluence red LED safety testing. Included for red-light skin safety and dose-escalation boundary; claim use is safety-only.
status: draft
quality: usable
aliases:
- source_artifact:clinicaltrials-nct03433222-2026-04-24
- Phase 1 Study of High Fluence LED-Red Light in Fitzpatrick Skin Types I to III
categories:
- skin-photobiomodulation
relations:
- type: related_protocol
  target: protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging
- type: parent_family
  target: experiment_family:skin-photobiomodulation
source:
  kind: external_protocol
  title: Phase 1 Study of High Fluence LED-Red Light in Fitzpatrick Skin Types I to III
  authors: ClinicalTrials.gov
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Phase 1 Study of High Fluence LED-Red Light in Fitzpatrick Skin Types I to III. ClinicalTrials.gov. 2026.
  url: https://clinicaltrials.gov/study/NCT03433222
researchEvidence:
  designKind: other
  designLabel: Clinical trial registration for phase I high-fluence LED-red light in Fitzpatrick I-III
  participantCount: 60
  participantCountKind: approximate
  populationLabel: Healthy non-Hispanic Caucasian adults with Fitzpatrick skin types I-III.
  durationLabel: Planned nine sessions over three weeks in the associated protocol.
  aggregateRole: context
  cohortKey: cohort:clinicaltrials-nct03433222-2026-04-24
evidenceBucket: red-light skin safety and dose-escalation boundary
whyItMatters: Use with the protocol/publication to preserve the lighter-skin versus darker-skin safety distinction.
potentialMurphEndpoints:
- Fitzpatrick I-III registry criteria
- registered safety endpoints
- dose-escalation provenance
protocolTakeaway: The registry documents Fitzpatrick I-III high-fluence red LED safety testing. Do not use registry alone to claim effectiveness.
murphTakeaway: Use with the protocol/publication to preserve the lighter-skin versus darker-skin safety distinction.
studyDesign: Clinical trial registration for phase I high-fluence LED-red light in Fitzpatrick I-III
modality: high-fluence red LED
claimUse: safety-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **red-light skin safety and dose-escalation boundary**.

**Findings:** Registry source only; it supports the safety-boundary rationale for lighter-skin cohorts.

**Why it matters:** Use with the protocol/publication to preserve the lighter-skin versus darker-skin safety distinction.

**Potential experiment signals:** Fitzpatrick I-III registry criteria, registered safety endpoints, dose-escalation provenance.

**Protocol takeaway:** The registry documents Fitzpatrick I-III high-fluence red LED safety testing. Do not use registry alone to claim effectiveness.

**Claim use:** `safety-only`.

### Extraction notes

- **Population:** Healthy non-Hispanic Caucasian adults with Fitzpatrick skin types I-III.
- **Intervention/exposure:** High-fluence LED red light at 480 and 640 J/cm².
- **Comparator/control:** Mock/sham irradiation.
- **Duration/follow-up:** Planned nine sessions over three weeks in the associated protocol.
- **Endpoints:** Safety, dose-limiting toxicity, MTD, erythema, blistering, and local cutaneous reactions.
- **Adverse events/safety notes:** No independent harm inference beyond registry-reported outcome fields.
- **Limitations:** Trial registry rather than full peer-reviewed outcome extraction.; Restricted lighter-skin cohort.
- **Population mismatch/directness:** Direct for red LED skin-type safety registry metadata; indirect for home-use photoaging outcomes.
- **Artifact/rights status:** unknown.
