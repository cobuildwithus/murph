---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-caffeine-too-much-2024-08-28
slug: sources/caffeine-timing/fda-caffeine-too-much-2024-08-28
title: 'Spilling the Beans: How Much Caffeine is Too Much?'
summary: FDA consumer guidance identifies coffee, tea, soft drinks, energy drinks, decaf coffee, foods, supplements, and over-the-counter products as caffeine sources and gives consumer-facing dose ranges that can inform all-source caffeine logs.
status: draft
quality: usable
aliases:
- 'Spilling the Beans: How Much Caffeine is Too Much?'
- source_artifact:fda-caffeine-too-much-2024-08-28
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: web_page
  title: 'Spilling the Beans: How Much Caffeine is Too Much?'
  authors: U.S. Food and Drug Administration
  year: 2024
  journal: FDA Consumer Updates
  citation: 'U.S. Food and Drug Administration. Spilling the Beans: How Much Caffeine is Too Much?. FDA Consumer Updates. 2024. URL: https://www.fda.gov/consumers/consumer-updates/spilling-beans-how-much-caffeine-too-much.'
  url: https://www.fda.gov/consumers/consumer-updates/spilling-beans-how-much-caffeine-too-much
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 6cb74f33f18177f1a9aec78ce17c067f112dd2ac00fb25b778be458b867c004d
    url: https://www.fda.gov/consumers/consumer-updates/spilling-beans-how-much-caffeine-too-much
  canonicalUrl: https://www.fda.gov/consumers/consumer-updates/spilling-beans-how-much-caffeine-too-much
researchEvidence:
  designKind: guideline
  designLabel: FDA consumer caffeine safety and source guidance
  populationLabel: General consumers and adults considering daily caffeine intake.
  durationLabel: Guidance page; no follow-up period.
  aggregateRole: primary
  cohortKey: fda-caffeine-consumer-guidance
  notes:
  - 'Intervention or exposure: Dietary caffeine from coffee, tea, soft drinks, energy drinks, decaf, foods, supplements, and over-the-counter products.'
  - 'Comparator or control: Not applicable.'
  - 'Endpoints: Daily caffeine dose, hidden caffeine source recognition, symptoms of excess intake, concentrated caffeine product safety.'
  - 'Effect or direction: The FDA page gives adult 400 mg/day context, lists typical caffeine ranges for common 12-ounce beverages, notes that decaf coffee is not caffeine-free, flags hidden caffeine in foods/supplements/OTC products, and warns about rapid intake of high-dose or pure caffeine products.'
  - 'Adverse events or safety notes: The guidance lists symptoms such as insomnia, jitters, anxiousness, fast heart rate, upset stomach, nausea, headache, and dysphoria, and warns about toxic effects with rapid consumption of around 1,200 mg caffeine or highly concentrated caffeine.'
  - 'Population mismatch: General caffeine safety/source guidance; not direct 14-day curfew efficacy evidence.'
  - 'Limitations: Consumer guidance rather than a trial; adult threshold does not apply uniformly to pregnancy, adolescents, medical conditions, or medication interactions.'
evidenceBucket: caffeine_source_dose_audit
whyItMatters: The FDA page is an official source for dose-tracking boundaries, hidden caffeine sources, decaf residual caffeine, and safety escalation language.
potentialMurphEndpoints:
- daily caffeine dose
- hidden caffeine source count
- adverse caffeine symptoms
- caffeine cutback adherence
protocolTakeaway: Use FDA guidance to support all-source caffeine logs, decaf-not-zero warnings, gradual cutback language, and clinician-contact boundaries for excess caffeine symptoms.
murphTakeaway: Daily caffeine dose should include beverages, foods, supplements, OTC products, decaf residual caffeine, and concentrated products.
studyDesign: guideline
modality: official-caffeine-safety-dose-guidance
claimUse: supports-protocol
sourceFindings:
- findingId: finding:fda-caffeine-too-much-2024-08-28-source-inventory-dose-context
  sourceKey: source_artifact:fda-caffeine-too-much-2024-08-28
  extractedFromArtifactId: art_fda_caffeine_too_much_2024_08_28_html
  findingKind: context
  population: General consumers.
  exposure: Caffeine from beverages, decaf coffee, foods, supplements, and OTC products.
  outcome: All-source daily caffeine accounting.
  summary: FDA consumer guidance identifies coffee, tea, soft drinks, energy drinks, decaf coffee, foods, supplements, and over-the-counter products as caffeine sources and gives consumer-facing dose ranges that can inform all-source caffeine logs.
  evidenceUse:
  - measurement
  - context
- findingId: finding:fda-caffeine-too-much-2024-08-28-excess-caffeine-safety-boundary
  sourceKey: source_artifact:fda-caffeine-too-much-2024-08-28
  extractedFromArtifactId: art_fda_caffeine_too_much_2024_08_28_html
  findingKind: safety
  population: General consumers and adults.
  exposure: High daily or rapid caffeine intake, including pure or highly concentrated caffeine.
  outcome: Symptoms and toxic-effect warnings.
  summary: FDA guidance notes that about 400 mg/day is not generally associated with dangerous negative effects for most adults, but warns about individual variability, common excess-caffeine symptoms, gradual cutback, and toxic effects with rapid high-dose or concentrated caffeine intake.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **caffeine_source_dose_audit**.

**Findings:** FDA consumer guidance identifies coffee, tea, soft drinks, energy drinks, decaf coffee, foods, supplements, and over-the-counter products as caffeine sources and gives consumer-facing dose ranges that can inform all-source caffeine logs. FDA guidance notes that about 400 mg/day is not generally associated with dangerous negative effects for most adults, but warns about individual variability, common excess-caffeine symptoms, gradual cutback, and toxic effects with rapid high-dose or concentrated caffeine intake.

**Why it matters:** The FDA page is an official source for dose-tracking boundaries, hidden caffeine sources, decaf residual caffeine, and safety escalation language.

**Potential experiment signals:** daily caffeine dose, hidden caffeine source count, adverse caffeine symptoms, caffeine cutback adherence.

**Protocol takeaway:** Use FDA guidance to support all-source caffeine logs, decaf-not-zero warnings, gradual cutback language, and clinician-contact boundaries for excess caffeine symptoms.

**Claim use:** `supports-protocol`.
