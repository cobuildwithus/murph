---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nice-low-back-pain-sciatica-ng59-2020-12-11
slug: sources/static-stretching/nice-low-back-pain-sciatica-ng59-2020-12-11
title: 'Low back pain and sciatica in over 16s: assessment and management'
summary: Clinical boundary source for low back pain and sciatica.
status: draft
quality: usable
aliases:
- 'Low back pain and sciatica in over 16s: assessment and management'
categories:
- static-stretching
relations:
-
  type: related_protocol
  target: protocol_variant:static-stretching/at-home-static-stretching-for-flexibility
-
  type: parent_family
  target: experiment_family:static-stretching
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    url: https://www.nice.org.uk/guidance/ng59
  canonicalUrl: https://www.nice.org.uk/guidance/ng59
source:
  kind: guideline
  title: 'Low back pain and sciatica in over 16s: assessment and management'
  authors: National Institute for Health and Care Excellence
  year: 2020
  journal: NICE Guideline NG59
  citation: 'National Institute for Health and Care Excellence. Low back pain and sciatica in over 16s: assessment and management. NICE guideline NG59. Published 2016; updated 2020 Dec 11.'
  url: https://www.nice.org.uk/guidance/ng59
researchEvidence:
  designKind: guideline
  designLabel: NICE clinical guideline
  populationLabel: People aged 16 years and over with low back pain or sciatica
  durationLabel: Clinical assessment and management pathway
  aggregateRole: synthesis
  cohortKey: nice-low-back-pain-sciatica-ng59-2020-12-11
  notes:
  - 'Intervention/exposure: Assessment and management guideline for low back pain and sciatica'
  - 'Comparator/control: No comparator'
  - 'Population mismatch: Symptomatic clinical population rather than general flexibility users.'
evidenceBucket: safety_guidelines_special_populations
whyItMatters: Radiating back/leg pain is a common scenario where unsupervised stretching can be misapplied.
potentialMurphEndpoints:
- alternative diagnosis screening
- sciatica
- risk stratification
- exercise options
- activity advice
- imaging boundaries
protocolTakeaway: Back/leg radiating pain, new/changing symptoms, and red-flag contexts should route users away from generic at-home stretching.
murphTakeaway: Use for stop rules and clinician-guidance language around sciatica and new/changing low-back symptoms.
studyDesign: NICE clinical guideline
modality: Low back pain and sciatica guideline
directness: safety_boundary
populationMismatch: Symptomatic clinical population rather than general flexibility users.
claimUse: safety-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **safety_guidelines_special_populations**.

**Findings:** NICE recommends considering alternative diagnoses when symptoms are new or changed and using risk stratification and needs/preferences/capabilities when considering exercise programs.

**Why it matters:** Radiating back/leg pain is a common scenario where unsupervised stretching can be misapplied.

**Potential experiment signals:** alternative diagnosis screening, sciatica, risk stratification, exercise options, activity advice, imaging boundaries.

**Safety notes:** Do not treat possible cancer, infection, trauma, or inflammatory disease symptoms as routine stretching targets; sciatica/radiating symptoms require careful boundary language.

**Limitations:** Clinical guideline for low back pain/sciatica, not a healthy-adult flexibility trial.

**Population mismatch:** Symptomatic clinical population rather than general flexibility users.

**Protocol takeaway:** Back/leg radiating pain, new/changing symptoms, and red-flag contexts should route users away from generic at-home stretching.

**Claim use:** `safety-only`.
