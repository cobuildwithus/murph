---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct04248972-2026-04-23
slug: sources/whole-body-photobiomodulation/clinicaltrials-gov-nct04248972-2026-04-23
title: Short- and Long-term Effects of Photobiomodulation on Pain, Functionality, Tissue Quality, Central Sensitisation and Psychological Factors in a Population Suffering From Fibromyalgia
summary: ClinicalTrials.gov registry record for the fibromyalgia whole-body PBM versus placebo program; useful for trial identity and scope, but no result tables were extracted from the accessible record.
status: draft
quality: usable
aliases:
  - NCT04248972
  - clinicaltrials-gov-nct04248972-2026-04-23
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
  title: Short- and Long-term Effects of Photobiomodulation on Pain, Functionality, Tissue Quality, Central Sensitisation and Psychological Factors in a Population Suffering From Fibromyalgia
  authors: ClinicalTrials.gov record
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Short- and Long-term Effects of Photobiomodulation on Pain, Functionality, Tissue Quality, Central Sensitisation and Psychological Factors in a Population Suffering From Fibromyalgia. Identifier NCT04248972.
  url: https://clinicaltrials.gov/study/NCT04248972
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Registry record for a completed randomized parallel-group fibromyalgia trial
  populationLabel: Fibromyalgia trial participants in an active-versus-placebo whole-body PBM study
  durationLabel: Short- and long-term follow-up were planned, but detailed schedule fields were not fully extractable from the registry record used here
  aggregateRole: primary
  cohortKey: nct04248972-fibromyalgia-rct
protocolEvidence:
  -
    protocolKey: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
    groupId: fm-rct-registry
    stance: context_only
    scope: clinical_supervised
    result: not_efficacy_evidence
    headline: Registry identifies the sham-controlled fibromyalgia whole-body PBM program but does not contribute extracted outcome results here.
    implication: Useful for trial identification, comparator boundaries, and registry linkage.
    caveat: Accessible registry extraction was sparse and did not expose posted results or detailed enrollment fields.
    displayPriority: 40
evidenceBucket: Chronic pain/fibromyalgia whole-body PBM sibling variant
whyItMatters: This registry key anchors the RCT program identity and helps keep protocol, registry, and publication records aligned without treating them as interchangeable efficacy evidence.
potentialMurphEndpoints:
  - pain
  - functionality
  - tissue quality
  - central sensitization
  - psychological factors
protocolTakeaway: Use as registry context only; do not treat it as an outcome source unless the results tables are directly extracted.
murphTakeaway: Helpful for trial linkage and protocol boundaries, not for benefit claims.
studyDesign: Registry record for a randomized placebo-controlled interventional study
modality: Whole-body photobiomodulation versus placebo in fibromyalgia
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **Chronic pain/fibromyalgia whole-body PBM sibling variant**.

**Findings:** The accessible registry record identifies NCT04248972 as a fibromyalgia study examining short- and long-term effects of photobiomodulation on pain, functionality, tissue quality, central sensitisation, and psychological factors. The record establishes the study as an interventional registry entry linked to the active-versus-placebo whole-body PBM program. However, the accessible extraction used here did not expose detailed enrollment fields or posted results tables.

**Why it matters:** This registry key anchors the RCT program identity and helps keep protocol, registry, and publication records aligned without treating them as interchangeable efficacy evidence.

**Potential experiment signals:** pain, functionality, tissue quality, central sensitization, psychological factors.

**Protocol takeaway:** Use as registry context only; do not treat it as an outcome source unless the results tables are directly extracted.

**Safety / adverse events:** The registry is useful for prospective study identification and comparator boundaries, but no extracted adverse-event or safety-outcome tables were available in the accessible record used here.

**Limitations:** Registry parsing was sparse in the accessible record; no extracted sample size, effect estimates, or result tables; registry records should not be treated as completed outcome papers by default.

**Population mismatch / directness:** Directness is high at the device/program level, but the source remains a supervised fibromyalgia trial registry rather than a generalized whole-body red/NIR exposure study.

**Artifact candidates / rights:** Best manifest candidate is an HTML snapshot from the public ClinicalTrials.gov page. Keep registry exports out of Git and re-export from the live registry or API before upload.

**Claim use:** `context-only`.
