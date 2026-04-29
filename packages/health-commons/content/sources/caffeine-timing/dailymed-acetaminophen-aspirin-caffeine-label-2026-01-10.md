---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:dailymed-acetaminophen-aspirin-caffeine-label-2026-01-10
slug: sources/caffeine-timing/dailymed-acetaminophen-aspirin-caffeine-label-2026-01-10
title: Acetaminophen, aspirin and caffeine capsule label
summary: DailyMed OTC medication label showing that caffeine-containing pain products can add hidden caffeine and can trigger sleeplessness or rapid heartbeat when combined with other caffeine sources.
status: draft
quality: usable
aliases:
- DailyMed acetaminophen aspirin caffeine label
- OTC acetaminophen aspirin caffeine label
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: guideline
  title: Acetaminophen, aspirin and caffeine capsule label
  authors: DailyMed / National Library of Medicine
  year: 2026
  journal: DailyMed drug label
  citation: DailyMed. Acetaminophen, aspirin and caffeine capsule label. Updated January 10, 2026.
  url: https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=4543e156-1deb-666e-e063-6394a90a719c
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 19cae63250bb7038ba76a4f7cf29a0c3905f61216e3a53902d28f463623e40cd
    url: https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=4543e156-1deb-666e-e063-6394a90a719c
  canonicalUrl: https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=4543e156-1deb-666e-e063-6394a90a719c
researchEvidence:
  designKind: guideline
  designLabel: OTC medication label
  populationLabel: OTC analgesic consumers
  durationLabel: Per labeled dosing episode
  aggregateRole: primary
  cohortKey: dailymed-acetaminophen-aspirin-caffeine-label-2026-01-10
evidenceBucket: clinical_safety_boundaries
whyItMatters: A caffeine curfew cannot be interpreted safely if a participant unknowingly takes caffeine from OTC analgesics; this label supports a medication-source audit rather than an efficacy claim.
potentialMurphEndpoints:
- biomarker:caffeine-dose
- biomarker:sleep-onset-latency
- biomarker:heart-rate
- biomarker:adverse-events
protocolTakeaway: Audit OTC pain-relief and migraine products for caffeine before starting; avoid treating medication caffeine as ordinary coffee intake.
murphTakeaway: Useful guardrail for hidden-source caffeine logging and stop-condition language around sleeplessness or rapid heartbeat.
studyDesign: OTC medication label
modality: caffeine safety boundary
claimUse: safety-only
limitations:
- Product-specific OTC label; not an intervention study; does not test caffeine curfew timing.
populationMismatch: Label users may differ from healthy adult caffeine-curfew participants; medication indication and aspirin/acetaminophen risks add non-caffeine safety issues.
directnessToProtocol: general_guideline
sourceFindings:
- findingId: finding:dailymed-acetaminophen-aspirin-caffeine-label-2026-01-10-01
  sourceKey: source_artifact:dailymed-acetaminophen-aspirin-caffeine-label-2026-01-10
  extractedFromArtifactId: art_dailymed_acetaminophen_aspirin_caffeine_label_2026_01_10_html
  findingKind: safety
  population: OTC analgesic users
  exposure: Acetaminophen/aspirin/caffeine product containing caffeine 65 mg per geltab
  outcome: Hidden caffeine dose from medication
  summary: The DailyMed label lists caffeine 65 mg in each geltab alongside acetaminophen 250 mg and aspirin 250 mg; adult directions allow repeated dosing, so medication use can materially add to total daily caffeine exposure.
  evidenceUse:
  - safety
  - context
- findingId: finding:dailymed-acetaminophen-aspirin-caffeine-label-2026-01-10-02
  sourceKey: source_artifact:dailymed-acetaminophen-aspirin-caffeine-label-2026-01-10
  extractedFromArtifactId: art_dailymed_acetaminophen_aspirin_caffeine_label_2026_01_10_html
  findingKind: adverse_event
  population: OTC analgesic users
  exposure: Caffeine-containing medication plus other caffeine sources
  outcome: Nervousness, irritability, sleeplessness, rapid heartbeat
  summary: The label warns that the recommended dose contains about as much caffeine as a cup of coffee and advises limiting caffeine-containing medicines, foods, or beverages because too much caffeine may cause nervousness, irritability, sleeplessness, and rapid heartbeat.
  evidenceUse:
  - safety
- findingId: finding:dailymed-acetaminophen-aspirin-caffeine-label-2026-01-10-03
  sourceKey: source_artifact:dailymed-acetaminophen-aspirin-caffeine-label-2026-01-10
  extractedFromArtifactId: art_dailymed_acetaminophen_aspirin_caffeine_label_2026_01_10_html
  findingKind: safety
  population: People who are pregnant, breastfeeding, have listed medical conditions, or take interacting medicines
  exposure: OTC acetaminophen/aspirin/caffeine product
  outcome: Use-with-clinician and overdose guardrails
  summary: The label includes physician/pharmacist cautions for multiple comorbidities and medication contexts, pregnancy/breastfeeding language, stop-use warnings, and Poison Control instructions for overdose.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **clinical_safety_boundaries**.

**Findings:**
- `finding:dailymed-acetaminophen-aspirin-caffeine-label-2026-01-10-01`: The DailyMed label lists caffeine 65 mg in each geltab alongside acetaminophen 250 mg and aspirin 250 mg; adult directions allow repeated dosing, so medication use can materially add to total daily caffeine exposure.
- `finding:dailymed-acetaminophen-aspirin-caffeine-label-2026-01-10-02`: The label warns that the recommended dose contains about as much caffeine as a cup of coffee and advises limiting caffeine-containing medicines, foods, or beverages because too much caffeine may cause nervousness, irritability, sleeplessness, and rapid heartbeat.
- `finding:dailymed-acetaminophen-aspirin-caffeine-label-2026-01-10-03`: The label includes physician/pharmacist cautions for multiple comorbidities and medication contexts, pregnancy/breastfeeding language, stop-use warnings, and Poison Control instructions for overdose.

**Why it matters:** A caffeine curfew cannot be interpreted safely if a participant unknowingly takes caffeine from OTC analgesics; this label supports a medication-source audit rather than an efficacy claim.

**Potential experiment signals:**
- biomarker:caffeine-dose
- biomarker:sleep-onset-latency
- biomarker:heart-rate
- biomarker:adverse-events

**Protocol takeaway:** Audit OTC pain-relief and migraine products for caffeine before starting; avoid treating medication caffeine as ordinary coffee intake.

**Claim use:** `safety-only`.
