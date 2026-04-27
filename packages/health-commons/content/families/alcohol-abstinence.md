---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:alcohol-abstinence
slug: families/alcohol-abstinence
title: Alcohol Abstinence
summary: Protocols that test a bounded alcohol-free interval, separated from alcohol reduction, intermittent abstinence, medical detoxification, AUD treatment, pregnancy counseling, and liver-disease care.
status: draft
quality: usable
aliases:
- alcohol-free challenges
- temporary alcohol abstinence
- short-term abstinence
- Dry January-style challenge
- sober-curious alcohol-free experiments
categories:
- alcohol-abstinence
- behavior-change
- safety-screened
familyKind: behavior_change
canonicalMechanism: bounded_complete_alcohol_abstinence
relations:
-
  type: related_protocol
  target: protocol_variant:alcohol-abstinence/short-term-alcohol-abstinence
-
  type: cites
  target: source_artifact:pmid-39489405
-
  type: cites
  target: source_artifact:pmid-32021698
-
  type: cites
  target: source_artifact:pmid-29730627
-
  type: cites
  target: source_artifact:pmid-26690637
-
  type: cites
  target: source_artifact:nice-alcohol-physical-complications-2017-04-12
-
  type: cites
  target: source_artifact:nice-alcohol-dependence-assessment-2014-10-21
-
  type: cites
  target: source_artifact:pmid-11900621
-
  type: cites
  target: source_artifact:pmid-15706735
-
  type: cites
  target: source_artifact:pmid-24657098
-
  type: cites
  target: source_artifact:pmid-25346507
-
  type: cites
  target: source_artifact:pmid-25999438
-
  type: cites
  target: source_artifact:pmid-27586815
-
  type: cites
  target: source_artifact:pmid-30167704
-
  type: cites
  target: source_artifact:pmid-30564004
-
  type: cites
  target: source_artifact:pmid-32511109
-
  type: cites
  target: source_artifact:cdc-alcohol-pregnancy-2026-04-02
-
  type: cites
  target: source_artifact:who-substance-use-pregnancy-2014-11-19
-
  type: cites
  target: source_artifact:fda-benzodiazepine-boxed-warning-2020-09-23
-
  type: cites
  target: source_artifact:fda-opioid-benzodiazepine-cns-depressants-alcohol-2016-08-31
-
  type: cites
  target: source_artifact:niaaa-alcohol-medication-interactions-2025-05-08
-
  type: cites
  target: source_artifact:samhsa-tip-42-co-occurring-disorders-2020
-
  type: cites
  target: source_artifact:pmid-38174913
-
  type: cites
  target: source_artifact:pmid-34998258
-
  type: cites
  target: source_artifact:pmid-41021116
-
  type: cites
  target: source_artifact:pmid-39830585
-
  type: cites
  target: source_artifact:pmid-40526204
-
  type: cites
  target: source_artifact:pmid-40485439
researchCoverage:
  auditCutoff: '2026-04-26'
  canonicalSourceRecords: 281
  sourcePageRecords: 271
  evidenceAppraisalRecords: 271
claims:
-
  claimId: self-guided-family-requires-clear-safety-screen
  type: safety
  text: Self-guided alcohol-abstinence family variants are only for appropriately screened adults who can reasonably stop drinking without withdrawal risk. Suspected dependence, prior withdrawal symptoms, high or uncertain intake, pregnancy/trying to conceive/breastfeeding questions, known or suspected liver disease, active AUD treatment, high-risk or complex medications, unstable mental health, co-occurring substance use, seizure disorder, or major medical instability should route to clinician-guided variants before any alcohol-free challenge is suggested.
  strength: high
  sourceKeys:
  - source_artifact:nice-alcohol-physical-complications-2017-04-12
  - source_artifact:nice-alcohol-dependence-assessment-2014-10-21
  - source_artifact:pmid-11900621
  - source_artifact:pmid-15706735
  - source_artifact:pmid-24657098
  - source_artifact:pmid-25346507
  - source_artifact:pmid-25999438
  - source_artifact:pmid-27586815
  - source_artifact:pmid-30167704
  - source_artifact:pmid-30564004
  - source_artifact:pmid-32511109
  - source_artifact:cdc-alcohol-pregnancy-2026-04-02
  - source_artifact:who-substance-use-pregnancy-2014-11-19
  - source_artifact:fda-benzodiazepine-boxed-warning-2020-09-23
  - source_artifact:fda-opioid-benzodiazepine-cns-depressants-alcohol-2016-08-31
  - source_artifact:niaaa-alcohol-medication-interactions-2025-05-08
  - source_artifact:samhsa-tip-42-co-occurring-disorders-2020
  - source_artifact:pmid-38174913
  - source_artifact:pmid-34998258
  - source_artifact:pmid-41021116
  - source_artifact:pmid-39830585
  - source_artifact:pmid-40526204
  - source_artifact:pmid-40485439
  caveats:
  - Clinician-guided variants should handle withdrawal, treatment, pregnancy, liver, medication, mental-health, co-occurring substance-use, seizure, cardiovascular, and adolescent contexts.
---

Self-guided alcohol-abstinence family variants are only for appropriately screened adults who can reasonably stop drinking without withdrawal risk. Suspected dependence, prior withdrawal symptoms, high or uncertain intake, pregnancy/trying to conceive/breastfeeding questions, known or suspected liver disease, active AUD treatment, high-risk or complex medications, unstable mental health, co-occurring substance use, seizure disorder, or major medical instability should route to clinician-guided variants before any alcohol-free challenge is suggested.


Alcohol abstinence is the broader family for protocols that remove alcoholic beverages for a bounded self-experiment window.

The family should stay neutral and safety-first: it is not a moral sobriety identity, detox pathway, AUD treatment, medication decision, pregnancy counseling plan, or liver-disease treatment. Complete abstinence, alcohol reduction, intermittent abstinence, medication-supported reduction, and supervised withdrawal should remain separate variants.
