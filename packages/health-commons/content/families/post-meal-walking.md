---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:post-meal-walking
slug: families/post-meal-walking
title: Post-Meal Walking
summary: Protocols that time gentle walking after meals, separated from generic step goals, pre-meal exercise, standing-only breaks, sedentary-break micro-walks, and supervised clinical diabetes protocols.
status: draft
quality: usable
aliases:
- post-meal walking family
- postprandial walking protocols
- after-meal walking protocols
categories:
- glucose
- metabolism
- walking
- post-meal
- activity
- cgm
familyKind: mechanism
canonicalMechanism: meal_timed_muscle_activity_during_postprandial_glucose_window
relations:
-
  type: related_protocol
  target: protocol_variant:post-meal-walking/walking-after-every-meal
-
  type: primary_biomarker
  target: biomarker:postprandial-glucose-excursion
-
  type: cites
  target: source_artifact:pmid-27747394
-
  type: cites
  target: source_artifact:pmid-23761134
-
  type: cites
  target: source_artifact:pmid-28883892
-
  type: cites
  target: source_artifact:pmid-33088646
-
  type: cites
  target: source_artifact:pmid-32173259
-
  type: cites
  target: source_artifact:pmid-19560716
-
  type: cites
  target: source_artifact:pmid-31318033
-
  type: cites
  target: source_artifact:american-diabetes-association-standards-care-2026-2025-12-08
-
  type: cites
  target: source_artifact:diabetes.org-blood-glucose-exercise-2026-04-25
researchCoverage:
  canonicalLedgerPath: output-packages/research/walking-after-every-meal/downloads/11-source-ledger-reducer/canonical_source_ledger_v1.json
  sourceCount: 241
  sourcePagesDrafted: 240
  auditCutoff: '2026-04-26'
  notes:
  - One consumer/influencer source was retained in the ledger but did not require a source page and is not cited for protocol claims.
  - Family boundary preserves direct after-main-meal walking separately from standing-only, micro-walk sedentary-break, longer after-dinner, and clinical-treatment variants.
---
Post-meal walking is the broader mechanism family for experiments that place gentle movement in the postprandial window.

The canonical Murph member is **Walking After Every Meal**, which targets 10–15 minutes after breakfast, lunch, and dinner. Dinner can be emphasized as a fallback window, but dinner-only walks, longer 20–30+ minute walks, pre-meal exercise, standing-only breaks, and frequent sedentary-break micro-walks should remain separate variants or context pages.

This family should not teach “flatten every glucose spike at any cost.” The evidence is strongest for meal-window glucose in specific populations and short studies, while safety and interpretation depend on medication context, pregnancy/GDM, fall risk, foot risk, route safety, meal content, and measurement fidelity.
