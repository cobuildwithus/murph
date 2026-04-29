---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:who-caffeine-pregnancy-2023-08-09
slug: sources/caffeine-timing/who-caffeine-pregnancy-2023-08-09
title: Restricting caffeine intake during pregnancy
summary: WHO pregnancy caffeine guidance recommending intake reduction for pregnant people with high daily caffeine intake and emphasizing all-source caffeine accounting.
status: draft
quality: usable
aliases:
- WHO caffeine pregnancy guidance
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: guideline
  title: Restricting caffeine intake during pregnancy
  authors: World Health Organization
  year: 2023
  journal: WHO eLENA intervention page
  citation: World Health Organization. Restricting caffeine intake during pregnancy. Updated August 9, 2023.
  url: https://www.who.int/tools/elena/interventions/caffeine-pregnancy
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: 1f03b6357d1854aec315491c09f8c020c121ce85b88824b2b587118ad91c6961
    url: https://www.who.int/tools/elena/interventions/caffeine-pregnancy
  canonicalUrl: https://www.who.int/tools/elena/interventions/caffeine-pregnancy
researchEvidence:
  designKind: guideline
  designLabel: WHO evidence-informed guidance page
  populationLabel: Pregnant people
  durationLabel: Pregnancy guidance context
  aggregateRole: primary
  cohortKey: who-caffeine-pregnancy-2023-08-09
evidenceBucket: clinical_safety_boundaries
whyItMatters: Pregnancy is a distinct safety context with altered caffeine clearance and fetal/neonatal outcomes that should not be mixed with sleep-timing efficacy claims.
potentialMurphEndpoints:
- biomarker:caffeine-dose
- biomarker:pregnancy-outcomes
- biomarker:adverse-events
protocolTakeaway: Pregnant users should use pregnancy-specific caffeine guidance and clinician support; a generic caffeine curfew reset is not the primary decision frame.
murphTakeaway: Current WHO pregnancy boundary source.
studyDesign: WHO evidence-informed guidance page
modality: caffeine safety boundary
claimUse: safety-only
limitations:
- Guidance page summarizes evidence; not a sleep-timing protocol trial; observational associations are not causal proof.
populationMismatch: Pregnancy physiology and outcomes differ from general adult sleep self-tracking.
directnessToProtocol: general_guideline
sourceFindings:
- findingId: finding:who-caffeine-pregnancy-2023-08-09-01
  sourceKey: source_artifact:who-caffeine-pregnancy-2023-08-09
  extractedFromArtifactId: art_who_caffeine_pregnancy_2023_08_09_html
  findingKind: safety
  population: Pregnant people with high daily caffeine intake
  exposure: Daily caffeine intake above 300 mg/day
  outcome: Pregnancy loss and low-birth-weight risk reduction
  summary: WHO recommends that pregnant women with high daily caffeine intake above 300 mg/day lower intake during pregnancy to reduce the risk of pregnancy loss and low-birth-weight neonates.
  evidenceUse:
  - safety
- findingId: finding:who-caffeine-pregnancy-2023-08-09-02
  sourceKey: source_artifact:who-caffeine-pregnancy-2023-08-09
  extractedFromArtifactId: art_who_caffeine_pregnancy_2023_08_09_html
  findingKind: context
  population: Pregnant people
  exposure: Caffeine from tea, coffee, soft drinks, chocolate, kola nuts, energy drinks, and some OTC medications
  outcome: All-source caffeine and slower pregnancy clearance
  summary: WHO notes that caffeine is found in many dietary and OTC medication sources and that maternal caffeine clearance slows substantially during pregnancy.
  evidenceUse:
  - context
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **clinical_safety_boundaries**.

**Findings:**
- `finding:who-caffeine-pregnancy-2023-08-09-01`: WHO recommends that pregnant women with high daily caffeine intake above 300 mg/day lower intake during pregnancy to reduce the risk of pregnancy loss and low-birth-weight neonates.
- `finding:who-caffeine-pregnancy-2023-08-09-02`: WHO notes that caffeine is found in many dietary and OTC medication sources and that maternal caffeine clearance slows substantially during pregnancy.

**Why it matters:** Pregnancy is a distinct safety context with altered caffeine clearance and fetal/neonatal outcomes that should not be mixed with sleep-timing efficacy claims.

**Potential experiment signals:**
- biomarker:caffeine-dose
- biomarker:pregnancy-outcomes
- biomarker:adverse-events

**Protocol takeaway:** Pregnant users should use pregnancy-specific caffeine guidance and clinician support; a generic caffeine curfew reset is not the primary decision frame.

**Claim use:** `safety-only`.
