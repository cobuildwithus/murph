---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct04525573-2026-04-24
slug: sources/skin-photobiomodulation/clinicaltrials-nct04525573-2026-04-24
title: Effects of a Red/Gold/IR LED Combination Therapy Against the Signs of Aging
summary: ClinicalTrials.gov red/gold/IR LED combination registry record; no efficacy outcomes extracted.
status: draft
quality: usable
aliases:
- Effects of a Red/Gold/IR LED Combination Therapy Against the Signs of Aging
- NCT04525573
categories:
- skin-photobiomodulation
relations:
- type: related_protocol
  target: protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging
- type: parent_family
  target: experiment_family:skin-photobiomodulation
source:
  kind: external_protocol
  title: Effects of a Red/Gold/IR LED Combination Therapy Against the Signs of Aging
  authors: ClinicalTrials.gov registry record
  year: 2020
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov registry record 2020. Effects of a Red/Gold/IR LED Combination Therapy Against the Signs of Aging ClinicalTrials.gov.
  url: https://clinicaltrials.gov/study/NCT04525573
researchEvidence:
  designKind: other
  designLabel: Open-label ClinicalTrials.gov registry record for a red/gold/IR LED combination intervention
  populationLabel: Registry population not fully extracted; search snippets showed possible mismatch with a fat-reduction/general-health registry title.
  durationLabel: Not extracted from available batch notes.
  aggregateRole: context
  cohortKey: nct04525573
evidenceBucket: 'wavelength sibling: red-only, amber/yellow, or broad-spectrum evidence'
whyItMatters: It flags a registered red/gold/IR combination intervention but should not be used as efficacy evidence.
potentialMurphEndpoints:
- registry status
- intervention description
- title mismatch
- results availability
protocolTakeaway: Do not use for efficacy or safety claims unless the registry is rechecked and posted results are extracted.
murphTakeaway: Registry-only sources need explicit separation from completed outcome evidence.
studyDesign: Clinical trial registry record; open-label design noted in extracted search context.
modality: Red/gold/infrared LED combination therapy; exact device and skin-aging relevance require registry verification.
claimUse: context-only
murphV1Priority: Low
pdfRightsStatus: open_access
---

This source is included for **wavelength sibling: red-only, amber/yellow, or broad-spectrum evidence**.

**Findings:** The source is a ClinicalTrials.gov registration for a red/gold/IR LED combination intervention. The batch extraction did not retrieve posted results, sample size, dose, or safety outcomes, and search context suggested a possible mismatch between skin-aging and fat-reduction/general-health titles. It should remain registry context only. Source key: `source_artifact:clinicaltrials-nct04525573-2026-04-24`.

**Why it matters:** It flags a registered red/gold/IR combination intervention but should not be used as efficacy evidence.

**Potential experiment signals:** registry status, intervention description, title mismatch, results availability.

**Protocol takeaway:** Do not use for efficacy or safety claims unless the registry is rechecked and posted results are extracted.

**Claim use:** `context-only`.
