---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1016-j.pmip.2025.100170"
slug: "sources/morning-light-exposure/doi-10.1016-j.pmip.2025.100170"
title: "Effects of daylight on sleep and circadian rhythms in patients with depression"
summary: "Effects of daylight on sleep and circadian rhythms in patients with depression is included as clinical_light_therapy_device_boundaries evidence for clinical light-therapy/device-treatment boundaries. A small randomized daylight add-on study in MDD reported improvements in mood, sleep quality, and circadian rhythm markers."
status: "draft"
quality: "usable"
aliases:
  - "Effects of daylight on sleep and circadian rhythms in patients with depression"
  - "doi-10.1016-j.pmip.2025.100170"
categories:
  - "morning-light-exposure"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:morning-light-exposure/morning-outdoor-light-exposure"
  -
    type: "parent_family"
    target: "experiment_family:morning-light-exposure"
source:
  kind: "journal_article"
  title: "Effects of daylight on sleep and circadian rhythms in patients with depression"
  authors: "José Ángel Rubiño-Díaz; M. Cristina Nicolau; Anna Riera-Gimeno; Aida Martín-Reina; Francesca Cañellas"
  year: 2025
  journal: "Personalized Medicine in Psychiatry"
  citation: "Rubiño-Díaz JÁ, Nicolau MC, Riera-Gimeno A, Martín-Reina A, Cañellas F. Effects of daylight on sleep and circadian rhythms in patients with depression. Personalized Medicine in Psychiatry. 2025;53-54:100170. doi:10.1016/j.pmip.2025.100170."
  doi: "10.1016/j.pmip.2025.100170"
  url: "https://doi.org/10.1016/j.pmip.2025.100170"
researchEvidence:
  designKind: "randomized_controlled_trial"
  designLabel: "Feasibility randomized daylight add-on study"
  participantCount: 38
  participantCountKind: "reported"
  populationLabel: "Twenty-one non-seasonal major depressive disorder outpatients plus 17 healthy volunteers; MDD patients were randomized to LIGHT (n=11) or treatment-as-usual (n=10)."
  durationLabel: "14 days"
  aggregateRole: "primary"
  cohortKey: "cohort:doi-10.1016-j.pmip.2025.100170"
evidenceBucket: "clinical_light_therapy_device_boundaries"
whyItMatters: "Useful as clinical daylight-treatment context, but not as default outdoor-habit efficacy evidence."
potentialMurphEndpoints:
  - "depressive symptom scores"
  - "subjective sleep quality"
  - "sleep diary"
  - "wearable light exposure"
  - "rest-activity rhythm"
  - "peripheral temperature rhythm"
protocolTakeaway: "Morning daylight timing and clinical supervision should be stated explicitly; do not generalize to healthy users or to device-free outdoor routines without caveat."
murphTakeaway: "A small randomized daylight add-on study in MDD reported improvements in mood, sleep quality, and circadian rhythm markers."
studyDesign: "rct"
modality: "specified daylight exposure before 11 a.m. plus antidepressant treatment"
claimUse: "context-only"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
---

This source is included for **clinical_light_therapy_device_boundaries**.

**Findings:** Population: Twenty-one non-seasonal major depressive disorder outpatients plus 17 healthy volunteers; MDD patients were randomized to LIGHT (n=11) or treatment-as-usual (n=10). Intervention/exposure: Regular specified daylight exposure for 14 days, described as increasing daylight exposure before 11 a.m., in conjunction with pharmacological treatment. Comparator/control: Treatment as usual/pharmacological treatment among MDD patients; healthy volunteers used as a reference group for circadian and sleep context. Duration/follow-up: 14 days Endpoints: QIDS-SR depressive symptoms, PSQI and sleep diary sleep quality, Munich Chronotype Questionnaire, Kronowise motor activity, skin temperature rhythm, light exposure. Effect/direction: LIGHT patients improved depressive symptoms, sleep quality, motor activity, and peripheral temperature rhythms more than treatment-as-usual patients; extract did not provide numeric effect sizes in accessible abstract text. Safety/adverse events: No adverse-event signal was extracted from accessible abstract-level text.

**Why it matters:** Useful as clinical daylight-treatment context, but not as default outdoor-habit efficacy evidence.

**Potential experiment signals:** depressive symptom scores, subjective sleep quality, sleep diary, wearable light exposure, rest-activity rhythm, peripheral temperature rhythm

**Protocol takeaway:** Morning daylight timing and clinical supervision should be stated explicitly; do not generalize to healthy users or to device-free outdoor routines without caveat.

**Directness and boundaries:** Directness is `clinical_supervised` with protocol-evidence scope `clinical_supervised`. Population mismatch: Clinical non-seasonal MDD outpatients receiving pharmacological care, not generally healthy protocol users.

**Limitations and uncertainty:** Small feasibility sample; clinical depression population; adjunctive to antidepressant treatment; not isolated as an unsupervised outdoor habit; numeric effect sizes not extracted from accessible abstract-level text.

**Claim use:** `context-only`.
