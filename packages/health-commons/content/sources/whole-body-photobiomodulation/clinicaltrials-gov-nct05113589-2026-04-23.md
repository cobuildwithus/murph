---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct05113589-2026-04-23
slug: sources/whole-body-photobiomodulation/clinicaltrials-gov-nct05113589-2026-04-23
title: Fibromyalgia and Circadian Blood Pressure
summary: ClinicalTrials.gov registry companion for the completed fibromyalgia trial focused on circadian blood pressure and autonomic outcomes after whole-body PBM versus placebo.
status: draft
quality: usable
aliases:
  - NCT05113589
  - clinicaltrials-gov-nct05113589-2026-04-23
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
  title: Fibromyalgia and Circadian Blood Pressure
  authors: ClinicalTrials.gov record
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Fibromyalgia and Circadian Blood Pressure. Identifier NCT05113589.
  url: https://clinicaltrials.gov/study/NCT05113589
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Registry record for a completed randomized fibromyalgia mechanistic trial
  populationLabel: Fibromyalgia participants in a randomized active-versus-placebo whole-body PBM trial focused on circadian blood pressure
  durationLabel: Whole-body PBM versus placebo; detailed session count was not fully extractable from the registry record used here
  aggregateRole: primary
  cohortKey: nct05113589-fibromyalgia-circadian
protocolEvidence:
  -
    protocolKey: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
    groupId: fm-circadian-registry
    stance: context_only
    scope: clinical_supervised
    result: not_efficacy_evidence
    headline: Registry identifies a completed whole-body PBM fibromyalgia trial focused on circadian blood pressure, but no extracted results are included here.
    implication: Useful for trial tracking and endpoint framing around autonomic physiology.
    caveat: The accessible registry extract did not expose detailed enrollment or results tables.
    displayPriority: 35
evidenceBucket: Chronic pain/fibromyalgia whole-body PBM sibling variant
whyItMatters: This registry key keeps the mechanistic blood-pressure trial separate from broader symptom papers and helps preserve endpoint directness.
potentialMurphEndpoints:
  - circadian blood pressure
  - autonomic symptoms
protocolTakeaway: Registry context only; do not use as an outcome source unless results are directly extracted from the registry.
murphTakeaway: Helpful for endpoint mapping, not for benefit claims.
studyDesign: Registry record for a completed randomized placebo-controlled trial
modality: Whole-body photobiomodulation versus placebo in fibromyalgia
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **Chronic pain/fibromyalgia whole-body PBM sibling variant**.

**Findings:** The accessible registry information identifies NCT05113589 as a completed fibromyalgia trial comparing PBM treatment with placebo PBM and focusing on circadian blood pressure and autonomic symptoms. It is best interpreted as a registry companion to the published mechanistic paper rather than as a results source, because the record used here did not expose detailed sample-size or outcome tables.

**Why it matters:** This registry key keeps the mechanistic blood-pressure trial separate from broader symptom papers and helps preserve endpoint directness.

**Potential experiment signals:** circadian blood pressure, autonomic symptoms.

**Protocol takeaway:** Registry context only; do not use as an outcome source unless results are directly extracted from the registry.

**Safety / adverse events:** No extracted adverse-event data were available in the accessible registry record used here.

**Limitations:** Sparse accessible registry extraction; no extracted enrollment figure; no direct result tables; should not be used as a surrogate for the published paper.

**Population mismatch / directness:** Direct whole-body intervention framing is relevant, but the source remains a supervised fibromyalgia registry record rather than a generalized protocol implementation source.

**Artifact candidates / rights:** Best manifest candidate is an HTML snapshot from ClinicalTrials.gov. Keep registry exports out of Git and re-export from the live registry or API before upload.

**Claim use:** `context-only`.
