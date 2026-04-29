---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.4172-2329-9096.1000157
slug: sources/daily-step-floor/doi-10.4172-2329-9096.1000157
title: 'Using Pedometer Step-Count Goals to Promote Physical Activity in Cardiac Rehabilitation: A Feasibility Study of a Controlled Trial'
summary: Small cardiac-rehab feasibility study found step-count goals increased daily steps under supervision.
status: draft
quality: usable
aliases:
- doi-10.4172-2329-9096.1000157
- doi:10.4172/2329-9096.1000157
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: journal_article
  title: 'Using Pedometer Step-Count Goals to Promote Physical Activity in Cardiac Rehabilitation: A Feasibility Study of a Controlled Trial'
  authors: Cupples M; Dean A; Tully MA; Taggart M; McCorkell G; O'Neill S; Coates V
  year: 2014
  journal: International Journal of Physical Medicine & Rehabilitation
  doi: 10.4172/2329-9096.1000157
  url: https://www.longdom.org/abstract/using-pedometer-stepcount-goals-to-promote-physical-activity-in-cardiac-rehabilitation-a-feasibility-study-of-a-controll-45826.html
  citation: 'Cupples M et al. Using Pedometer Step-Count Goals to Promote Physical Activity in Cardiac Rehabilitation: A Feasibility Study of a Controlled Trial. International Journal of Physical Medicine & Rehabilitation. 2014. doi:10.4172/2329-9096.1000157'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.4172/2329-9096.1000157
    titleHash: 458fa78998ac090ec529ee9705d760191373c2c127b615092d379f1902f067a5
    url: https://www.longdom.org/abstract/using-pedometer-stepcount-goals-to-promote-physical-activity-in-cardiac-rehabilitation-a-feasibility-study-of-a-controll-45826.html
  canonicalUrl: https://www.longdom.org/abstract/using-pedometer-stepcount-goals-to-promote-physical-activity-in-cardiac-rehabilitation-a-feasibility-study-of-a-controll-45826.html
researchEvidence:
  designKind: controlled_trial
  designLabel: Feasibility controlled trial in cardiac rehabilitation
  populationLabel: Adults completing supervised cardiac rehabilitation
  durationLabel: 6-week intervention.
  cohortKey: doi-10-4172-2329-9096-1000157
  participantCount: 45
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: safety_special_populations
sourceKind: journal_article
population: People after supervised cardiac rehabilitation entering a controlled feasibility study.
interventionOrExposure: Pedometer feedback with individualized daily step-count goals reviewed weekly by rehabilitation staff.
comparatorOrControl: Controls wore pedometers without readings and received weekly facilitator contact.
endpoints:
- daily steps
- feasibility
- cardiac rehabilitation maintenance
limitations:
- Small feasibility study; not a general Daily Step Floor trial; intervention occurred after formal cardiac rehab.
adverseEventsOrSafety: Clinical cardiac rehabilitation context; requires medical clearance and supervision when applied to cardiac populations.
populationMismatch: Cardiac rehabilitation special population; context-only for general protocol.
directness: clinical_supervised
directnessToDailyStepFloor: clinical_supervised adjacent variant
whyItMatters: Shows supervised step-goal setting can be feasible in cardiac rehab maintenance, but only within a clinical pathway.
potentialMurphEndpoints:
- daily-step-count
- exercise adherence
- cardiac symptoms
- adverse-events
protocolTakeaway: Use as clinical-supervised context; Daily Step Floor should not independently prescribe step goals to cardiac rehab patients without clearance.
murphTakeaway: Step goals in cardiac rehab are a supervised implementation precedent, not direct community evidence.
studyDesign: Feasibility controlled trial
modality: Pedometer step-count goals in cardiac rehabilitation
claimUse: context-only
sourceFindings:
- findingId: finding:doi-10-4172-2329-9096-1000157:cardiac-rehab-step-goals
  sourceKey: source_artifact:doi-10.4172-2329-9096.1000157
  extractedFromArtifactId: art_doi_10_4172_2329_9096_1000157_publisher_page
  findingKind: intervention_result
  population: People after supervised cardiac rehabilitation entering a controlled feasibility study.
  exposure: Pedometer feedback with individualized daily step-count goals reviewed weekly by rehabilitation staff.
  outcome: daily steps; feasibility; cardiac rehabilitation maintenance
  summary: A small controlled feasibility study in cardiac rehabilitation found weekly individualized pedometer step goals increased daily steps by about 2,742 steps/day over 6 weeks compared with minimal change in controls.
  evidenceUse:
  - efficacy
  - adjacent_variant
  - context
murphV1Priority: Medium
pdfRightsStatus: open_access
artifacts:
- artifactId: art_doi_10_4172_2329_9096_1000157_publisher_page
  kind: html
  storage: external
  rightsStatus: open_access
  redistributable: false
  sourceKey: source_artifact:doi-10.4172-2329-9096.1000157
  sourceUrl: https://www.longdom.org/abstract/using-pedometer-stepcount-goals-to-promote-physical-activity-in-cardiac-rehabilitation-a-feasibility-study-of-a-controll-45826.html
  contentType: text/html
  accessNotes: 'Open-access source according to batch rights guess; no PDF binary stored in Git. Rights-safe draft: no PDF or copyrighted full text is committed; redistributability remains false until rights review, checksum capture, and approved storage.'
---

This source is included for **safety_special_populations**.

**Findings:** A small controlled feasibility study in cardiac rehabilitation found weekly individualized pedometer step goals increased daily steps by about 2,742 steps/day over 6 weeks compared with minimal change in controls.

**Why it matters:** Shows supervised step-goal setting can be feasible in cardiac rehab maintenance, but only within a clinical pathway.

**Potential experiment signals:** daily-step-count, exercise adherence, cardiac symptoms, adverse-events.

**Protocol takeaway:** Use as clinical-supervised context; Daily Step Floor should not independently prescribe step goals to cardiac rehab patients without clearance.

**Claim use:** `context-only`.

**Directness boundary:** clinical_supervised adjacent variant. Do not promote this source into direct Daily Step Floor claims beyond the stated claim-use boundary.

**Safety/adverse events:** Clinical cardiac rehabilitation context; requires medical clearance and supervision when applied to cardiac populations.

**Limitations and mismatch:** Small feasibility study; not a general Daily Step Floor trial; intervention occurred after formal cardiac rehab. Cardiac rehabilitation special population; context-only for general protocol.
