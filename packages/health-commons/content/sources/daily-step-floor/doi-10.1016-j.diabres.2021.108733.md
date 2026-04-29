---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1016-j.diabres.2021.108733
slug: sources/daily-step-floor/doi-10.1016-j.diabres.2021.108733
title: Should weight-bearing activity be reduced during healing of plantar diabetic foot ulcers, even when using appropriate offloading devices?
summary: Mixed review evidence keeps active plantar diabetic foot ulcers as a safety boundary.
status: draft
quality: usable
aliases:
- doi-10.1016-j.diabres.2021.108733
- doi:10.1016/j.diabres.2021.108733
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: review
  title: Should weight-bearing activity be reduced during healing of plantar diabetic foot ulcers, even when using appropriate offloading devices?
  authors: Jarl G; van Netten JJ; Lazzarini PA; Crews RT; Najafi B; Mueller MJ
  year: 2021
  journal: Diabetes Research and Clinical Practice
  doi: 10.1016/j.diabres.2021.108733
  url: https://doi.org/10.1016/j.diabres.2021.108733
  citation: Jarl G et al. Should weight-bearing activity be reduced during healing of plantar diabetic foot ulcers, even when using appropriate offloading devices?. Diabetes Research and Clinical Practice. 2021. doi:10.1016/j.diabres.2021.108733
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1016/j.diabres.2021.108733
    titleHash: 87af1ffa6a8cccb214d73f84e15e70cb40a0022f141c1e95e4ba95dda087dd07
    url: https://doi.org/10.1016/j.diabres.2021.108733
  canonicalUrl: https://doi.org/10.1016/j.diabres.2021.108733
researchEvidence:
  designKind: narrative_review
  designLabel: Narrative review of weight-bearing activity during plantar diabetic foot-ulcer healing
  populationLabel: People with plantar diabetic foot ulcers using offloading devices
  durationLabel: Review of ulcer-healing studies with varying follow-up; no single intervention duration.
  cohortKey: doi-10-1016-j-diabres-2021-108733
  includedStudyCount: 6
  aggregateRole: synthesis
evidenceBucket: safety_special_populations
sourceKind: review
population: People with plantar diabetic foot ulcers during healing, including users of offloading devices.
interventionOrExposure: Daily weight-bearing physical activity/steps during ulcer healing.
comparatorOrControl: Lower weight-bearing activity or no clear exposure comparison across reviewed studies.
endpoints:
- plantar diabetic foot-ulcer healing
- daily steps or weight-bearing activity
- offloading adherence
- ulcer outcomes
limitations:
- Narrative review with small and heterogeneous underlying studies; weak evidence and no direct Daily Step Floor trial.
adverseEventsOrSafety: Active plantar ulcer healing is a high-risk state; walking/step increases may need reduction or strict offloading depending on clinician assessment.
populationMismatch: Active plantar ulcer population; safety boundary only for general daily step-floor use.
directness: clinical_supervised
directnessToDailyStepFloor: clinical_supervised safety boundary for active diabetic foot ulcers
whyItMatters: Flags that active plantar diabetic foot ulcers are not a routine step-goal context, even when offloading devices are used.
potentialMurphEndpoints:
- daily-step-count
- ulcer-healing status
- offloading adherence
- adverse-events
protocolTakeaway: For users with active plantar diabetic foot ulcers, Daily Step Floor should require clinician-directed offloading and may need pause/reduction rather than a generic floor.
murphTakeaway: Use as safety-only evidence for active-ulcer exclusion, escalation, or clinician-supervised exceptions.
studyDesign: Narrative review
modality: Weight-bearing activity during diabetic foot-ulcer healing
claimUse: safety-only
sourceFindings:
- findingId: finding:doi-10-1016-j-diabres-2021-108733:ulcer-healing-weight-bearing-mixed
  sourceKey: source_artifact:doi-10.1016-j.diabres.2021.108733
  extractedFromArtifactId: art_doi_10_1016_j_diabres_2021_108733_publisher_page
  findingKind: safety
  population: People with plantar diabetic foot ulcers during healing, including users of offloading devices.
  exposure: Daily weight-bearing physical activity/steps during ulcer healing.
  outcome: plantar diabetic foot-ulcer healing; daily steps or weight-bearing activity; offloading adherence; ulcer outcomes
  summary: Evidence on weight-bearing activity during plantar diabetic foot-ulcer healing was weak and mixed, with one reviewed study suggesting worse healing with more steps, several showing no significant association, and some unclear results.
  evidenceUse:
  - safety
  - context
murphV1Priority: High
pdfRightsStatus: permission_required
artifacts:
- artifactId: art_doi_10_1016_j_diabres_2021_108733_publisher_page
  kind: html
  storage: external
  rightsStatus: permission_required
  redistributable: false
  sourceKey: source_artifact:doi-10.1016-j.diabres.2021.108733
  sourceUrl: https://doi.org/10.1016/j.diabres.2021.108733
  contentType: text/html
  accessNotes: 'External scholarly source; do not store publisher PDF/binary in Git without rights review. Rights-safe draft: no PDF or copyrighted full text is committed; redistributability remains false until rights review, checksum capture, and approved storage.'
---

This source is included for **safety_special_populations**.

**Findings:** Evidence on weight-bearing activity during plantar diabetic foot-ulcer healing was weak and mixed, with one reviewed study suggesting worse healing with more steps, several showing no significant association, and some unclear results.

**Why it matters:** Flags that active plantar diabetic foot ulcers are not a routine step-goal context, even when offloading devices are used.

**Potential experiment signals:** daily-step-count, ulcer-healing status, offloading adherence, adverse-events.

**Protocol takeaway:** For users with active plantar diabetic foot ulcers, Daily Step Floor should require clinician-directed offloading and may need pause/reduction rather than a generic floor.

**Claim use:** `safety-only`.

**Directness boundary:** clinical_supervised safety boundary for active diabetic foot ulcers. Do not promote this source into direct Daily Step Floor claims beyond the stated claim-use boundary.

**Safety/adverse events:** Active plantar ulcer healing is a high-risk state; walking/step increases may need reduction or strict offloading depending on clinician assessment.

**Limitations and mismatch:** Narrative review with small and heterogeneous underlying studies; weak evidence and no direct Daily Step Floor trial. Active plantar ulcer population; safety boundary only for general daily step-floor use.
