---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:caffeine-timing
slug: families/caffeine-timing
title: Caffeine Timing
summary: Protocols that adjust when caffeine is consumed, how much is consumed, or how completely caffeine sources are counted, while separating adult sleep self-experiments from pregnancy, pediatric, dependence, shift-work, and performance variants.
status: draft
quality: usable
aliases:
- caffeine curfew
- caffeine cutoff
- morning-only caffeine
- caffeine timing reset
- caffeine dose reset
categories:
- sleep
- caffeine
- circadian
- behavior-change
familyKind: behavior_timing
canonicalMechanism: reduce_active_caffeine_exposure_near_sleep_window
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: cites
  target: source_artifact:caffeine-timing-bibliography
researchCoverage:
  bibliographyKey: source_artifact:caffeine-timing-bibliography
  auditCutoff: '2026-04-27'
---

Caffeine Timing is the broader family for experiments that change caffeine timing, dose, source accounting, or abstinence windows.

This family should not collapse every caffeine question into one protocol. A general adult sleep curfew, total abstinence, caffeine-dependence treatment, pregnancy or lactation guidance, pediatric/adolescent use, shift-work alertness plans, athletic ergogenic timing, and medication-interaction management are separate variants with different risks and evidence standards.
