---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1016/j.jbmt.2005.06.002
slug: sources/static-stretching/doi-10.1016-j.jbmt.2005.06.002
title: Inter-tester reliability of a self-monitored active knee extension test
summary: Self-monitored AKE reliability source; useful for measurement-error context and low-burden angular-test feasibility.
status: draft
quality: usable
aliases:
- Inter-tester reliability of a self-monitored active knee extension test
- doi:10.1016/j.jbmt.2005.06.002
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
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1016/j.jbmt.2005.06.002
    url: https://doi.org/10.1016/j.jbmt.2005.06.002
  canonicalUrl: https://doi.org/10.1016/j.jbmt.2005.06.002
  identityAliases:
  - Inter-tester reliability of a self-monitored active knee extension test
  - doi:10.1016/j.jbmt.2005.06.002
source:
  kind: journal_article
  title: Inter-tester reliability of a self-monitored active knee extension test
  authors: Norris, C. M.; Matthews, M.
  year: 2005
  journal: Journal of Bodywork and Movement Therapies
  citation: Norris, C. M.; Matthews, M. Inter-tester reliability of a self-monitored active knee extension test. Journal of Bodywork and Movement Therapies. 2005. doi:10.1016/j.jbmt.2005.06.002.
  doi: 10.1016/j.jbmt.2005.06.002
  url: https://doi.org/10.1016/j.jbmt.2005.06.002
researchEvidence:
  designKind: other
  designLabel: Inter-tester reliability study of self-monitored active knee extension
  participantCount: 20
  participantCountKind: reported
  populationLabel: Asymptomatic students aged 20 to 24 years; 7 men and 13 women.
  durationLabel: Two consecutive test days.
  aggregateRole: context
  cohortKey: doi-10.1016-j.jbmt.2005.06.002
  notes:
  - 'Intervention/exposure: Self-monitored active knee extension test with right femur held at 90 degrees.'
  - 'Comparator/control: Two testers over two consecutive days.'
  - 'Endpoints: Active knee extension angle, Inter-tester reliability, Limits of agreement.'
  - 'Effect/direction: Mean AKE was reported as 145.45 degrees (SD 8.4) and 147.2 degrees (SD 9.04). Inter-tester ICC was 0.761 with 95% CI 0.395 to 0.905; limits of agreement were approximately -15 to +17 degrees.'
  - 'Adverse events/safety: No adverse events extracted.'
  - 'Population mismatch: Home-adjacent angular test, not direct reach-test logging.'
  - 'Limitations: Small young asymptomatic sample.; Limits of agreement are wide for detecting small personal changes.; AKE is more complex than a household sit-and-reach test.'
evidenceBucket: home_field_test_measurement
whyItMatters: It cautions that even self-monitored angular tests can have wide agreement limits, supporting simple, standardized field endpoints for home use.
potentialMurphEndpoints:
- Active knee extension angle
- Limits of agreement
- Inter-tester consistency
protocolTakeaway: Use as context for measurement error; avoid interpreting small angular hamstring changes without repeatability checks.
murphTakeaway: Use as context for measurement error; avoid interpreting small angular hamstring changes without repeatability checks.
studyDesign: Inter-tester reliability study of self-monitored active knee extension
modality: Home-usable flexibility field-test measurement
directnessToProtocol: background
claimUse: context-only
claimUseBoundary: Use for measurement/endpoints only; do not use as intervention-efficacy evidence.
murphV1Priority: Medium
pdfRightsStatus: permission_required
---

This source is included for **home_field_test_measurement**.

**Findings:** Mean AKE was reported as 145.45 degrees (SD 8.4) and 147.2 degrees (SD 9.04). Inter-tester ICC was 0.761 with 95% CI 0.395 to 0.905; limits of agreement were approximately -15 to +17 degrees.

**Why it matters:** It cautions that even self-monitored angular tests can have wide agreement limits, supporting simple, standardized field endpoints for home use.

**Potential experiment signals:** Active knee extension angle, Limits of agreement, Inter-tester consistency.

**Protocol takeaway:** Use as context for measurement error; avoid interpreting small angular hamstring changes without repeatability checks.

**Claim use:** `context-only`.

## Extraction notes

- **Population:** Asymptomatic students aged 20 to 24 years; 7 men and 13 women.
- **Comparator/control:** Two testers over two consecutive days.
- **Duration/follow-up:** Two consecutive test days.
- **Adverse events or safety notes:** No adverse events extracted.
- **Limitations:** Small young asymptomatic sample.; Limits of agreement are wide for detecting small personal changes.; AKE is more complex than a household sit-and-reach test.
- **Population mismatch:** Home-adjacent angular test, not direct reach-test logging.
- **Artifact rights:** permission_required; no copyrighted PDF is included in Git by this draft.
