---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1101-2023.03.03.23286452
slug: sources/whole-body-photobiomodulation/doi-10.1101-2023.03.03.23286452
title: "Whole-Body Photobiomodulation Therapy for Chronic Pain: A Feasibility Trial"
summary: Single-arm medRxiv feasibility study in a supervised fibromyalgia/chronic widespread pain cohort used 18 whole-body NovoTHOR sessions over about 6 weeks and reported broad symptom improvement, but the DOI appears under both chronic-pain and fibromyalgia titles and remains a preprint.
status: draft
quality: usable
aliases:
  - 10.1101/2023.03.03.23286452
  - 'Whole-Body Photobiomodulation Therapy for Fibromyalgia: A Feasibility Trial'
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
  kind: other
  title: "Whole-Body Photobiomodulation Therapy for Chronic Pain: A Feasibility Trial"
  authors: Fitzmaurice BC, Heneghan NR, Rayen ATA, Grenfell RL, Soundy AA
  year: 2023
  journal: medRxiv
  citation: "Fitzmaurice BC, Heneghan NR, Rayen ATA, Grenfell RL, Soundy AA. Whole-Body Photobiomodulation Therapy for Chronic Pain: A Feasibility Trial. medRxiv. 2023. doi:10.1101/2023.03.03.23286452."
  doi: 10.1101/2023.03.03.23286452
  url: https://doi.org/10.1101/2023.03.03.23286452
researchEvidence:
  designKind: pilot_intervention
  designLabel: Single-arm feasibility trial with embedded qualitative component (preprint)
  participantCount: 21
  participantCountKind: reported
  populationLabel: Adults recruited from a chronic pain service; accessible source text identifies the treated cohort as clinician-diagnosed fibromyalgia
  durationLabel: 18 sessions over approximately 6 weeks plus 24-week follow-up
  aggregateRole: primary
  cohortKey: fitzmaurice-2023-fm-feasibility
protocolEvidence:
  -
    protocolKey: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
    groupId: sibling-variant-literatures
    stance: context_only
    scope: clinical_supervised
    result: positive
    headline: This supervised single-arm whole-body NovoTHOR feasibility study reported broad symptom improvement and high acceptability after 18 sessions, but it has no control group and remains a preprint with title-metadata conflict.
    implication: Useful for disease-specific supervised implementation context and candidate outcome selection, not as a direct consumer efficacy claim.
    caveat: Accessible source surfaces disagree on whether the title is chronic-pain or fibromyalgia focused; the study is uncontrolled, preprint-only, and includes internal dose-reporting inconsistencies that should not be normalized away.
    displayPriority: 45
evidenceBucket: Dose, device, and implementation reporting
whyItMatters: This is the closest supervised whole-body clinical implementation source in the batch, but it remains population-mismatched for unsupervised wellness use and should stay inside a clinical-supervised context bucket.
potentialMurphEndpoints:
  - FIQR
  - pain severity
  - fatigue
  - sleep disturbance
  - HADS anxiety/depression
  - tender point count
  - Stroop performance
  - patient global impression of change
protocolTakeaway: Use as supervised fibromyalgia feasibility context and for candidate endpoint selection; do not promote it into a direct home-use efficacy claim.
murphTakeaway: This source is valuable because it shows what a supervised whole-body course looked like in practice, including schedule and outcome domains, while still preserving nonrandomized and preprint limitations.
studyDesign: Single-arm feasibility trial with embedded qualitative component (preprint)
modality: NovoTHOR whole-body red and near-infrared photobiomodulation
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: permission_required
---

This source is included for **Dose, device, and implementation reporting**.

**Findings:** Accessible preprint text and abstract describe a single-arm feasibility study in a fibromyalgia population recruited through a chronic pain service. Forty-nine participants were screened, 21 started treatment, and 19 completed 18 whole-body PBMT sessions over approximately 6 weeks. The preprint tables describe a NovoTHOR LED clamshell delivering red 660 nm and near-infrared 850 nm light in a 50:50 ratio, with session escalation from 6 minutes to 12 minutes to 20 minutes across the first two then remaining sessions. Positive changes were reported across fibromyalgia-specific quality of life, pain, tenderness, stiffness, fatigue, sleep disturbance, anxiety, depression, and cognitive impairment, with patient global assessment improved at 6 weeks and still improved at 24 weeks. Post-treatment physiological parameters did not reveal adverse effects. However, the DOI appears under both chronic-pain and fibromyalgia titles across accessible surfaces, and the preprint text itself exposes a dose-reporting discrepancy between 25 J/cm^2 in the TIDieR intervention description and 33.6 J/cm^2 in the NovoTHOR parameter table.

**Why it matters:** This is the most clinically supervised whole-body source in the batch, but it is still an uncontrolled preprint in a fibromyalgia cohort and should remain population-mismatched context for a broader Murph protocol.

**Potential experiment signals:** FIQR, pain, tenderness, fatigue, sleep disturbance, mood, cognitive performance, adverse effects, adherence.

**Protocol takeaway:** Use as clinical-supervised context and endpoint inspiration. Do not use it as direct efficacy proof for unsupervised whole-body red/NIR use.

**Claim use:** `context-only`.
