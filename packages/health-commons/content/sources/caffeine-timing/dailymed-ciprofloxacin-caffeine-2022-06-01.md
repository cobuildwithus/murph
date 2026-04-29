---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:dailymed-ciprofloxacin-caffeine-2022-06-01
slug: sources/caffeine-timing/dailymed-ciprofloxacin-caffeine-2022-06-01
title: Ciprofloxacin tablet label
summary: DailyMed drug-label evidence that ciprofloxacin can slow caffeine clearance and increase caffeine effects, making ordinary caffeine timing/dose assumptions unreliable during treatment.
status: draft
quality: usable
aliases:
- DailyMed ciprofloxacin label
- Ciprofloxacin caffeine interaction label
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: web_page
  title: Ciprofloxacin tablet label
  authors: DailyMed / National Library of Medicine
  year: 2022
  journal: DailyMed drug label
  citation: DailyMed. Ciprofloxacin tablet label. Updated June 1, 2022.
  url: https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=fbcd32c0-bcfd-4cc7-8e81-6612bc0cfc45
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 2489253ed8744aeb0d1817faff03b537090d98b4503b0eb5ebcc82ce44ad1049
    url: https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=fbcd32c0-bcfd-4cc7-8e81-6612bc0cfc45
  canonicalUrl: https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=fbcd32c0-bcfd-4cc7-8e81-6612bc0cfc45
researchEvidence:
  designKind: guideline
  designLabel: Prescription drug label
  populationLabel: Patients using ciprofloxacin
  durationLabel: During ciprofloxacin exposure
  aggregateRole: primary
  cohortKey: dailymed-ciprofloxacin-caffeine-2022-06-01
evidenceBucket: clinical_safety_boundaries
whyItMatters: 'Ciprofloxacin is a concrete medication-interaction boundary: caffeine effects can last longer because clearance is reduced.'
potentialMurphEndpoints:
- biomarker:caffeine-dose
- biomarker:sleep-onset-latency
- biomarker:heart-rate
- biomarker:adverse-events
protocolTakeaway: People taking ciprofloxacin should not treat the protocol as a simple self-experiment without clinician/pharmacist guidance on caffeine exposure.
murphTakeaway: Supports medication-interaction checks before interpreting caffeine-curfew sleep outcomes.
studyDesign: Prescription drug label
modality: caffeine safety boundary
claimUse: safety-only
limitations:
- Prescription drug label; not a sleep intervention study; the caffeine interaction may not generalize to all antibiotics.
populationMismatch: Applies to ciprofloxacin users rather than the general protocol population.
directnessToProtocol: general_guideline
sourceFindings:
- findingId: finding:dailymed-ciprofloxacin-caffeine-2022-06-01-01
  sourceKey: source_artifact:dailymed-ciprofloxacin-caffeine-2022-06-01
  extractedFromArtifactId: art_dailymed_ciprofloxacin_caffeine_2022_06_01_html
  findingKind: safety
  population: Patients prescribed ciprofloxacin
  exposure: Ciprofloxacin co-administered with caffeine
  outcome: Reduced caffeine clearance and prolonged half-life
  summary: The ciprofloxacin label states that quinolones including ciprofloxacin interfere with caffeine metabolism, which may reduce caffeine clearance and prolong caffeine serum half-life.
  evidenceUse:
  - safety
  - mechanism
- findingId: finding:dailymed-ciprofloxacin-caffeine-2022-06-01-02
  sourceKey: source_artifact:dailymed-ciprofloxacin-caffeine-2022-06-01
  extractedFromArtifactId: art_dailymed_ciprofloxacin_caffeine_2022_06_01_html
  findingKind: adverse_event
  population: Patients prescribed ciprofloxacin
  exposure: Caffeine exposure during ciprofloxacin therapy
  outcome: Increased caffeine effects or caffeine accumulation
  summary: Patient-facing label language warns that ciprofloxacin may increase the effects of caffeine and that quinolones can increase the possibility of caffeine accumulation.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **clinical_safety_boundaries**.

**Findings:**
- `finding:dailymed-ciprofloxacin-caffeine-2022-06-01-01`: The ciprofloxacin label states that quinolones including ciprofloxacin interfere with caffeine metabolism, which may reduce caffeine clearance and prolong caffeine serum half-life.
- `finding:dailymed-ciprofloxacin-caffeine-2022-06-01-02`: Patient-facing label language warns that ciprofloxacin may increase the effects of caffeine and that quinolones can increase the possibility of caffeine accumulation.

**Why it matters:** Ciprofloxacin is a concrete medication-interaction boundary: caffeine effects can last longer because clearance is reduced.

**Potential experiment signals:**
- biomarker:caffeine-dose
- biomarker:sleep-onset-latency
- biomarker:heart-rate
- biomarker:adverse-events

**Protocol takeaway:** People taking ciprofloxacin should not treat the protocol as a simple self-experiment without clinician/pharmacist guidance on caffeine exposure.

**Claim use:** `safety-only`.
