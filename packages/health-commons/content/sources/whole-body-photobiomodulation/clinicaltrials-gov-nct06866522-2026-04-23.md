---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct06866522-2026-04-23
slug: sources/whole-body-photobiomodulation/clinicaltrials-gov-nct06866522-2026-04-23
title: Light Reflection on Human Skin in Whole-Body Photobiomodulation Therapy
summary: Recruiting interventional registry studying how much red and near-infrared light is reflected from skin during whole-body PBM across skin phototypes and sex; dosimetry context, not efficacy evidence.
status: draft
quality: usable
aliases:
  - NCT06866522
  - clinicaltrials-gov-nct06866522-2026-04-23
categories:
  - whole-body-photobiomodulation
relations:
  -
    type: related_protocol
    target: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
  -
    type: parent_family
    target: experiment_family:whole-body-photobiomodulation
source:
  kind: web_page
  title: Light Reflection on Human Skin in Whole-Body Photobiomodulation Therapy
  authors: Universidade Federal de Sao Carlos (sponsor)
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Light Reflection on Human Skin in Whole-Body Photobiomodulation Therapy. Identifier NCT06866522.
  url: https://clinicaltrials.gov/study/NCT06866522
researchEvidence:
  designKind: other
  designLabel: Recruiting interventional registry measuring reflected light during whole-body PBM
  participantCount: 72
  participantCountKind: approximate
  populationLabel: Healthy adults aged 18-30 years; both sexes; grouped by skin phototype I/II, III/IV, and V/VI
  durationLabel: Study-period exposure assessment; registry does not provide efficacy follow-up results
  aggregateRole: primary
  cohortKey: nct06866522-healthy-phototype-groups
evidenceBucket: Dose, device, and implementation reporting
whyItMatters: Whole-body beds often irradiate skin without direct contact, so reflected-light loss and phototype differences matter for dose assumptions.
potentialMurphEndpoints:
  - reflected-light measurement
  - skin phototype grouping
  - thermal sensation
  - device-to-skin distance
protocolTakeaway: Use as skin-interaction and dosing-context evidence; do not use as benefit evidence.
murphTakeaway: This is useful for non-contact geometry and phototype considerations, especially when translating nominal device output into likely delivered exposure.
studyDesign: Recruiting interventional dosimetry registry
modality: Whole-body PBM skin-reflection and phototype study
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: unknown
---

This source is included for **Dose, device, and implementation reporting**.

**Findings:** This recruiting registry is built to quantify reflected light during whole-body PBMT rather than to test symptoms or disease outcomes. The accessible registry surfaces describe healthy adults aged 18-30 years grouped by skin phototype and sex, with reflected-light measurements planned at the biceps, abdomen, lumbar region, thighs, and calves. Mirrored registry details also expose a 20 cm non-contact geometry with red 660 nm and near-infrared 850 nm exposure, making it a useful implementation-context source for light loss at the skin boundary.

**Why it matters:** Whole-body devices commonly advertise nominal output at the panel rather than delivered dose at the body. This registry helps keep that distinction visible.

**Potential experiment signals:** reflected-light loss, phototype grouping, non-contact distance, thermal comfort.

**Protocol takeaway:** Use as adjacent-variant dosimetry context for non-contact whole-body exposure; do not promote it into a clinical efficacy claim.

**Claim use:** `context-only`.
