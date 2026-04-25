---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:omega-3-supplementation
slug: families/omega-3-supplementation
title: Omega-3 Supplementation
summary: Umbrella family for omega-3 intake and status protocols, with Oral EPA/DHA Supplementation as the Murph starter variant and adjacent seafood, ALA, krill, cod-liver, prescription, pregnancy, pediatric, and clinical-care variants kept separate.
status: field-testing
quality: usable
aliases:
- omega-3s
- omega-3 fatty acids
- EPA/DHA
- long-chain omega-3
categories:
- nutrition
- supplementation
- omega-3
- lipids
- lab-marker
- safety-boundary
relations:
-
  type: related_protocol
  target: protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation
-
  type: cites
  target: source_artifact:pmid-31396625
-
  type: cites
  target: source_artifact:pmid-36742439
-
  type: cites
  target: source_artifact:pmid-37264945
-
  type: cites
  target: source_artifact:pmid-18774613
-
  type: cites
  target: source_artifact:pmid-29387889
-
  type: cites
  target: source_artifact:pmid-32114706
-
  type: cites
  target: source_artifact:pmid-34057665
-
  type: cites
  target: source_artifact:pmid-38742535
-
  type: cites
  target: source_artifact:ods-omega-3-fatty-acids-health-professional-2026-04-25
-
  type: cites
  target: source_artifact:nccih-omega-3-supplements-2026-04-25
-
  type: cites
  target: source_artifact:pmid-16188209
-
  type: cites
  target: source_artifact:pmid-19269799
-
  type: cites
  target: source_artifact:health-canada-cod-liver-oil-monograph-2025-09-26
-
  type: cites
  target: source_artifact:dailymed-icosapent-ethyl-label-2026-04-25
lineage:
  relationship: root
  rationale: Family root for omega-3 protocols; variants are separated when the source, dose, population, clinical supervision, or measurement target changes materially.
attribution:
  ownerType: murph
  note: Drafted from the omega-3 supplementation research run and canonical source ledger.
researchCoverage:
  sourceLedgerRecords: 382
  sourcePagesDrafted: 380
  excludedNotExtractedRecords: 2
  researchRunCutoffDate: '2026-04-25'
  excludedNotExtractedSourceKeys:
  - source_artifact:pmid-41461240
  - source_artifact:clinicaltrials-nct07157241-2026-04-25
claims:
-
  claimId: family-scope-preformed-epa-dha-first
  type: evidence_scope
  text: The family contains multiple omega-3 exposure routes, but Murph should treat oral preformed EPA/DHA as the starter variant and keep ALA foods, seafood, krill oil, cod liver oil, prescription products, pregnancy/pediatric, and clinical nutrition contexts separate.
  strength: high
  sourceKeys:
  - source_artifact:pmid-31396625
  - source_artifact:pmid-36742439
  - source_artifact:nccih-omega-3-supplements-2026-04-25
  - source_artifact:pmid-16188209
  - source_artifact:pmid-19269799
  - source_artifact:pmid-31919792
  - source_artifact:health-canada-cod-liver-oil-monograph-2025-09-26
-
  claimId: family-direct-signal-blood-status
  type: intervention_result
  text: The most direct family-level signal for oral preformed EPA/DHA is a blood EPA/DHA-status response, with triglyceride changes as a lipid-context signal.
  strength: high
  sourceKeys:
  - source_artifact:pmid-31396625
  - source_artifact:pmid-36742439
  - source_artifact:pmid-37264945
  - source_artifact:pmid-18774613
-
  claimId: family-cvd-event-claim-boundary
  type: mixed_evidence
  text: Omega-3 supplementation should not be summarized as a blanket cardiovascular-event-prevention family because broad outcome evidence is mixed or null and positive high-dose/prescription contexts are separate clinical variants.
  strength: high
  sourceKeys:
  - source_artifact:pmid-22968891
  - source_artifact:pmid-29387889
  - source_artifact:pmid-32114706
  - source_artifact:pmid-30415637
  - source_artifact:pmid-30415628
  - source_artifact:pmid-33190147
-
  claimId: family-safety-boundaries-first
  type: safety
  text: Family pages and protocol variants should foreground safety boundaries around AF/flutter or unexplained rhythm symptoms, antithrombotic/regular NSAID/bleeding-relevant supplement use, bleeding disorders, procedures, allergy/hypersensitivity, pregnancy/lactation, pediatric use, severe lipid/pancreatitis care, liver or LDL-C monitoring, gout, immunosuppression/high-dose exposure, cod-liver retinol exposure, and prescription/high-dose care.
  strength: high
  sourceKeys:
  - source_artifact:pmid-34057665
  - source_artifact:pmid-34612056
  - source_artifact:pmid-38742535
  - source_artifact:ods-omega-3-fatty-acids-health-professional-2026-04-25
  - source_artifact:dailymed-lovaza-label-2026-04-25
  - source_artifact:dailymed-vascepa-label-2026-04-25
  - source_artifact:dailymed-icosapent-ethyl-label-2026-04-25
---

## Family scope

Omega-3 Supplementation is the umbrella for protocols that change omega-3 intake, omega-3 status, or omega-3-related lipid context. The first Murph canonical variant is **Oral EPA/DHA Supplementation**, which uses preformed EPA and DHA from a stable oral product and treats omega-3 index/RBC EPA+DHA as the primary lab-enabled endpoint.

## Variant boundaries

Keep these separate unless a dedicated variant is created: seafood or fish-meal protocols, ALA/flax/chia/walnut protocols, krill oil, cod liver oil, algal DHA-only protocols, prescription omega-3 products, multi-gram clinician-directed therapy, pregnancy/lactation protocols, pediatric protocols, allergy/hypersensitivity pathways, arrhythmia or bleeding-risk pathways, severe hypertriglyceridemia or pancreatitis care, liver/LDL monitoring, gout, immunosuppression/high-dose contexts, clinical nutrition, and disease-treatment pathways.

## Evidence posture

The family is strongest for measurable exposure/status changes and triglyceride-context effects. It is mixed for cardiovascular event prevention and not strong enough to make default claims for mood, cognition, dry-eye, exercise recovery, soreness, or inflammation outcomes. Murph should show safety boundaries before efficacy copy when a user tries to create an omega-3 experiment, especially for rhythm, bleeding/procedure, allergy, pregnancy/lactation, pediatric, liver/LDL, gout, immunosuppression, severe lipid/pancreatitis, cod-liver-oil, and prescription/high-dose contexts.

## Canonical starter

Use `protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation` as the default runnable Murph experiment when the user wants to test an oral EPA/DHA supplement and does not have a clinical or life-stage boundary that requires a separate pathway.
