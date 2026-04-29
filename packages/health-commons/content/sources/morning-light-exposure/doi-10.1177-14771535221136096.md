---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1177-14771535221136096"
slug: "sources/morning-light-exposure/doi-10.1177-14771535221136096"
title: "The relationship of light exposure to sleep outcomes among office workers. Part 1: Working in the office versus at home before and during the COVID-pandemic"
summary: "This office-worker study monitored light and sleep for 4-6 weeks and found lower afternoon light on home workdays, almost five minutes longer total sleep time at home, unchanged sleep efficiency, and timing associations that were not always in the expected direction."
status: "draft"
quality: "usable"
aliases:
  - "The relationship of light exposure to sleep outcomes among office workers. Part 1: Working in the office versus at home before and during the COVID-pandemic"
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
  title: "The relationship of light exposure to sleep outcomes among office workers. Part 1: Working in the office versus at home before and during the COVID-pandemic"
  authors: "M. B. C. Aries; G. Fischl; A. Lowden; F. Beute"
  year: 2024
  journal: "Lighting Research & Technology"
  citation: "Aries MBC, Fischl G, Lowden A, Beute F. The relationship of light exposure to sleep outcomes among office workers. Part 1: Working in the office versus at home before and during the COVID-pandemic. Light Res Technol. 2024;56(2):113-125. doi:10.1177/14771535221136096."
  doi: "10.1177/14771535221136096"
  url: "https://journals.sagepub.com/doi/10.1177/14771535221136096"
researchEvidence:
  designKind: "prospective_cohort"
  designLabel: "Office-worker ambulatory light and sleep study during office versus home workdays"
  participantCount: 15
  participantCountKind: "reported"
  populationLabel: "Full-time office employees monitored during the COVID-pandemic period, comparing office and home workdays."
  durationLabel: "Four to six weeks of ambulatory light and sleep monitoring."
  aggregateRole: "primary"
  cohortKey: "aries-2024-light-sleep-part1-office-home"
evidenceBucket: "indoor_workplace_classroom_home_daylight"
whyItMatters: "It shows that real-world light-sleep relationships can be complex and shaped by work location and routines, not just light intensity."
potentialMurphEndpoints:
  - "morning median illuminance"
  - "afternoon median illuminance"
  - "evening light exposure"
  - "sleep onset"
  - "awakening time"
  - "total sleep time"
  - "sleep efficiency"
  - "work location"
protocolTakeaway: "Use as naturalistic context and confounder evidence; do not interpret as an outdoor morning-light intervention."
murphTakeaway: "Work-from-home versus office patterns may change light dose and sleep timing; collect work-location context when interpreting morning-light outcomes."
studyDesign: "Naturalistic ambulatory cohort"
modality: "Measured light exposure during office versus home workdays"
claimUse: "context-only"
murphV1Priority: "Medium"
pdfRightsStatus: "unknown"
---

This source is included for **indoor_workplace_classroom_home_daylight**.

**Findings:** Home workdays had lower afternoon light than office workdays, total sleep time was almost five minutes longer at home, and sleep efficiency was similar. Higher afternoon light related to later sleep onset on office workdays; higher morning light related to earlier awakening. These mixed associations argue against simple causal claims.

**Why it matters:** It shows that real-world light-sleep relationships can be complex and shaped by work location and routines, not just light intensity.

**Potential experiment signals:** Morning/afternoon/evening median illuminance, total sleep time, sleep onset, sleep offset/awakening, sleep efficiency, work location, and COVID-era routine context.

**Protocol takeaway:** Use as naturalistic context and confounder evidence; do not interpret as an outdoor morning-light intervention.

**Claim use:** `context-only`.
