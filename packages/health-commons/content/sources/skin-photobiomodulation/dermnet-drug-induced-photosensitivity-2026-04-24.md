---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:dermnet-drug-induced-photosensitivity-2026-04-24
slug: sources/skin-photobiomodulation/dermnet-drug-induced-photosensitivity-2026-04-24
title: Drug-induced photosensitivity
summary: DermNet provides practical symptom and timing language for drug-induced photosensitivity. Included for photosensitizing-medication and retinoid safety boundary; claim use is safety-only.
status: draft
quality: usable
aliases:
- source_artifact:dermnet-drug-induced-photosensitivity-2026-04-24
- Drug-induced photosensitivity
categories:
- skin-photobiomodulation
relations:
- type: related_protocol
  target: protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging
- type: parent_family
  target: experiment_family:skin-photobiomodulation
source:
  kind: web_page
  title: Drug-induced photosensitivity
  authors: DermNet
  year: 2026
  journal: DermNet
  citation: DermNet. Drug-induced photosensitivity. DermNet. 2026.
  url: https://dermnetnz.org/topics/drug-induced-photosensitivity
researchEvidence:
  designKind: guideline
  designLabel: Clinical dermatology reference on drug-induced photosensitivity
  populationLabel: Patients and clinicians evaluating drug-induced photosensitivity.
  durationLabel: Reaction timing differs by phototoxic versus photoallergic mechanism.
  aggregateRole: primary
  cohortKey: cohort:dermnet-drug-induced-photosensitivity-2026-04-24
evidenceBucket: photosensitizing-medication and retinoid safety boundary
whyItMatters: 'Use for stop-condition language: burning, swelling, blistering, or persistent hyperpigmentation after light exposure should stop the protocol and prompt care.'
potentialMurphEndpoints:
- minutes-to-hours symptom timing
- blister stop rule
- PIH persistence tracking
protocolTakeaway: DermNet provides practical symptom and timing language for drug-induced photosensitivity. Wavelength relevance must be considered for red/NIR devices.
murphTakeaway: 'Use for stop-condition language: burning, swelling, blistering, or persistent hyperpigmentation after light exposure should stop the protocol and prompt care.'
studyDesign: Clinical dermatology reference on drug-induced photosensitivity
modality: photosensitizing medications plus UV/visible light
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: unknown
---

This source is included for **photosensitizing-medication and retinoid safety boundary**.

**Findings:** DermNet describes drug-induced photosensitivity as eruptions after visible or UV exposure in patients taking topical or systemic photosensitizing medications; phototoxic reactions are more common and can occur within minutes to hours.

**Why it matters:** Use for stop-condition language: burning, swelling, blistering, or persistent hyperpigmentation after light exposure should stop the protocol and prompt care.

**Potential experiment signals:** minutes-to-hours symptom timing, blister stop rule, PIH persistence tracking.

**Protocol takeaway:** DermNet provides practical symptom and timing language for drug-induced photosensitivity. Wavelength relevance must be considered for red/NIR devices.

**Claim use:** `safety-only`.

### Extraction notes

- **Population:** Patients and clinicians evaluating drug-induced photosensitivity.
- **Intervention/exposure:** Photosensitizing medications with visible or ultraviolet radiation exposure.
- **Comparator/control:** Not applicable.
- **Duration/follow-up:** Reaction timing differs by phototoxic versus photoallergic mechanism.
- **Endpoints:** Phototoxic/photoallergic reactions, timing, symptoms, diagnosis, complications, and prevention/management.
- **Adverse events/safety notes:** Phototoxic reactions can resemble exaggerated sunburn with erythema, oedema, burning/stinging, vesicles, or bullae; post-inflammatory hyperpigmentation may persist.
- **Limitations:** Clinical reference, not a trial.; Mostly sun/UV/visible context rather than red/NIR PBM.
- **Population mismatch/directness:** Medication and symptom safety boundary only.
- **Artifact/rights status:** unknown.
