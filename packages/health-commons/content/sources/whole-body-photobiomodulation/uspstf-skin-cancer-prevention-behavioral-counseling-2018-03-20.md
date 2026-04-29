---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:uspstf-skin-cancer-prevention-behavioral-counseling-2018-03-20
slug: sources/whole-body-photobiomodulation/uspstf-skin-cancer-prevention-behavioral-counseling-2018-03-20
title: "Skin Cancer Prevention: Behavioral Counseling"
summary: USPSTF counseling recommendation reinforces avoiding indoor tanning and minimizing UV exposure as skin-cancer prevention.
status: draft
quality: usable
aliases:
  - uspstf-skin-cancer-prevention-behavioral-counseling-2018-03-20
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
  kind: guideline
  title: "Skin Cancer Prevention: Behavioral Counseling"
  authors: US Preventive Services Task Force
  year: 2018
  journal: US Preventive Services Task Force
  citation: "US Preventive Services Task Force. Skin Cancer Prevention: Behavioral Counseling. 2018."
  url: https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/skin-cancer-counseling
researchEvidence:
  designKind: guideline
  designLabel: Preventive services recommendation statement
  populationLabel: Fair-skinned children, adolescents, young adults, and selectively counseled older adults regarding ultraviolet exposure
  durationLabel: Not a single intervention follow-up; counseling recommendation informed by an evidence review
  aggregateRole: synthesis
  cohortKey: uspstf-2018-skin-cancer-counseling
evidenceBucket: Adjacent-variant and exclusion boundary anchors
whyItMatters: It grounds the UV-exposure boundary in a clinical preventive-services framework and reinforces that indoor tanning is a harm-prevention topic, not a PBM efficacy topic.
potentialMurphEndpoints:
  - UV exposure behavior
  - indoor tanning avoidance
  - skin-cancer risk counseling
protocolTakeaway: Use only as a clinical safety boundary around UV and indoor tanning.
murphTakeaway: Important because user-facing whole-body light-bed language should avoid any drift toward tanning analogies or UV-risk confusion.
studyDesign: Preventive services recommendation statement informed by evidence review
modality: Behavioral counseling to reduce ultraviolet exposure and indoor tanning
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **Adjacent-variant and exclusion boundary anchors**.

**Findings:** USPSTF recommends counseling fair-skinned people aged 6 months to 24 years to minimize ultraviolet exposure and selectively counseling adults older than 24 years based on risk factors. The recommendation explicitly includes avoiding indoor tanning. Its supporting evidence review links indoor tanning with increased melanoma risk and also notes increased squamous and basal cell carcinoma risks in systematic reviews and observational studies. This is a safety boundary source only; it does not address therapeutic red/NIR photobiomodulation.

**Why it matters:** It reinforces the clinical counseling boundary around ultraviolet exposure and indoor tanning.

**Potential experiment signals:** UV exposure behavior, indoor tanning avoidance, skin-cancer risk counseling.

**Protocol takeaway:** Use strictly as a safety-boundary source. It should not be used to imply anything about whole-body PBM efficacy.

**Claim use:** `safety-only`.
