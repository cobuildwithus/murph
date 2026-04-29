---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:rxlist-red-yeast-rice-2026-04-26"
slug: "sources/red-yeast-rice/rxlist-red-yeast-rice-2026-04-26"
title: "Red Yeast Rice: Generic, Uses, Side Effects, Dosages, Interactions, Warnings"
summary: "RxList consumer drug-information page listing red yeast rice dosage examples, common adverse effects, severe/serious interaction categories, liver-function contraindications, and pregnancy/lactation avoidance."
status: "draft"
quality: "usable"
aliases:
  - "RxList red yeast rice generic drug page"
  - "Red yeast rice RxList interactions warnings"
categories:
  - "red-yeast-rice"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "web_page"
  title: "Red Yeast Rice: Generic, Uses, Side Effects, Dosages, Interactions, Warnings"
  authors: "RxList"
  year: 2026
  journal: "RxList Drug Information"
  citation: "RxList. Red Yeast Rice: Generic, Uses, Side Effects, Dosages, Interactions, Warnings. Accessed April 26, 2026."
  url: "https://www.rxlist.com/red_yeast_rice/generic-drug.htm"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "320a542aeb15e96fbb722af3b862882b53353d96490c0c7654c669d2ec57ded6"
    url: "https://www.rxlist.com/red_yeast_rice/generic-drug.htm"
  canonicalUrl: "https://www.rxlist.com/red_yeast_rice/generic-drug.htm"
researchEvidence:
  designKind: "other"
  designLabel: "Consumer drug-information reference"
  populationLabel: "Consumers and clinicians reviewing red yeast rice side effects, interactions, and warnings"
  durationLabel: "Not applicable; drug-information reference"
  aggregateRole: "context"
  cohortKey: "rxlist-red-yeast-rice-drug-info"
  notes:
    - "No participant count is reported for this consumer drug-information page."
evidenceBucket: "Interactions, contraindications, and population boundaries"
whyItMatters: "Provides a broad consumer-facing adverse-effect and interaction checklist for protocol onboarding and stop rules."
potentialMurphEndpoints:
  - "statin-medication-screen"
  - "liver-dysfunction-screen"
  - "pregnancy-lactation-screen"
  - "grapefruit-and-St-Johns-wort-screen"
  - "ALT/AST"
  - "CK"
  - "muscle-symptom-log"
protocolTakeaway: "Use as a safety boundary: screen for liver dysfunction, pregnancy/lactation, statin use, and interacting agents; warn users to seek clinician advice before use."
murphTakeaway: "RxList contributes broad safety and interaction guardrails, not a controlled efficacy signal."
studyDesign: "Consumer drug-information reference"
modality: "Red yeast rice supplement exposure"
directness: "same_mechanism"
claimUse: "safety-only"
sourceFindings:

  -
    findingId: "finding:rxlist-ryr-statin-and-drug-interactions"
    findingKind: "safety"
    population: "People considering red yeast rice while taking other medicines or supplements"
    exposure: "Red yeast rice with statins, grapefruit, lanthanum carbonate, maraviroc, St. John’s wort, or other interacting drugs"
    outcome: "Drug-interaction boundary"
    summary: "RxList lists severe interactions with statins and other serious or moderate interaction categories, supporting medication-list screening before red yeast rice use."
    evidenceUse:
      - "safety"
    sourceKey: "source_artifact:rxlist-red-yeast-rice-2026-04-26"
  -
    findingId: "finding:rxlist-ryr-liver-pregnancy-boundary"
    findingKind: "safety"
    population: "People with abnormal liver function, liver dysfunction, pregnancy, or breastfeeding"
    exposure: "Red yeast rice supplement exposure"
    outcome: "Contraindication or avoidance boundary"
    summary: "RxList identifies abnormal liver function/liver dysfunction and concurrent hepatotoxic agents as contraindication contexts and advises avoiding red yeast rice during pregnancy and breastfeeding."
    evidenceUse:
      - "safety"
    sourceKey: "source_artifact:rxlist-red-yeast-rice-2026-04-26"
  -
    findingId: "finding:rxlist-ryr-adverse-effects"
    findingKind: "adverse_event"
    population: "Consumers using red yeast rice products"
    exposure: "Red yeast rice supplement use"
    outcome: "Reported side effects including gastrointestinal symptoms, dizziness, headache, muscle symptoms, and elevated creatine kinase or liver enzymes"
    summary: "RxList lists common or reported adverse effects including gastrointestinal discomfort, dizziness, headache, muscle aches or weakness, elevated creatine kinase, and elevated liver enzymes, supporting symptom and lab monitoring."
    evidenceUse:
      - "safety"
    sourceKey: "source_artifact:rxlist-red-yeast-rice-2026-04-26"
murphV1Priority: "High"
pdfRightsStatus: "unknown"
---
This source is included for **Interactions, contraindications, and population boundaries**.

**Findings:**
- `finding:rxlist-ryr-statin-and-drug-interactions` — RxList lists severe interactions with statins and other serious or moderate interaction categories, supporting medication-list screening before red yeast rice use.
- `finding:rxlist-ryr-liver-pregnancy-boundary` — RxList identifies abnormal liver function/liver dysfunction and concurrent hepatotoxic agents as contraindication contexts and advises avoiding red yeast rice during pregnancy and breastfeeding.
- `finding:rxlist-ryr-adverse-effects` — RxList lists common or reported adverse effects including gastrointestinal discomfort, dizziness, headache, muscle aches or weakness, elevated creatine kinase, and elevated liver enzymes, supporting symptom and lab monitoring.

**Why it matters:** Provides a broad consumer-facing adverse-effect and interaction checklist for protocol onboarding and stop rules.

**Potential experiment signals:** statin-medication-screen, liver-dysfunction-screen, pregnancy-lactation-screen, grapefruit-and-St-Johns-wort-screen, ALT/AST, CK, muscle-symptom-log.

**Protocol takeaway:** Use as a safety boundary: screen for liver dysfunction, pregnancy/lactation, statin use, and interacting agents; warn users to seek clinician advice before use.

**Limitations:** Consumer drug-information page; interaction list is broad and not accompanied by red yeast rice-specific effect estimates or incidence rates.

**Population mismatch:** General consumer reference; not tailored to a standardized red yeast rice product or cholesterol protocol cohort.

**Claim use:** `safety-only`.
