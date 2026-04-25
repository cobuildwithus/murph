---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct00336336-2026-04-25
slug: sources/omega-3-supplementation/clinicaltrials-nct00336336-2026-04-25
title: 'GISSI-HF: Effects of n-3 PUFA and Rosuvastatin on Mortality-Morbidity of Patients With Symptomatic CHF'
summary: ClinicalTrials.gov registry anchor for GISSI-HF.
status: draft
quality: usable
aliases:
- ClinicalTrials.gov / Gruppo Italiano per lo Studio della Sopravvivenza nell'Infarto Miocardico 2026
categories:
- omega-3-supplementation
relations:
-
  type: related_protocol
  target: protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation
-
  type: parent_family
  target: experiment_family:omega-3-supplementation
source:
  kind: other
  title: 'GISSI-HF: Effects of n-3 PUFA and Rosuvastatin on Mortality-Morbidity of Patients With Symptomatic CHF'
  authors: ClinicalTrials.gov / Gruppo Italiano per lo Studio della Sopravvivenza nell'Infarto Miocardico
  year: 2026
  journal: ClinicalTrials.gov
  citation: 'ClinicalTrials.gov / Gruppo Italiano per lo Studio della Sopravvivenza nell''Infarto Miocardico. GISSI-HF: Effects of n-3 PUFA and Rosuvastatin on Mortality-Morbidity of Patients With Symptomatic CHF. ClinicalTrials.gov. 2026. Accessed 2026-04-25.'
  url: https://clinicaltrials.gov/study/NCT00336336
researchEvidence:
  designKind: other
  designLabel: Trial Registry
  participantCount: 6975
  participantCountKind: reported
  populationLabel: patients with symptomatic chronic heart failure
  durationLabel: linked GISSI-HF follow-up about 3.9 years
  aggregateRole: context
  cohortKey: omega-3-supplementation:clinicaltrials-nct00336336-2026-04-25
evidenceBucket: cardiovascular_outcomes_boundary
whyItMatters: Keeps trial registration separate from clinical-result claims.
potentialMurphEndpoints:
- process:trial-registration
- condition:heart-failure
protocolTakeaway: Do not cite registry for efficacy.
murphTakeaway: Adjacent registry source only.
studyDesign: trial_registry
modality: trial registry
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---
This source is included for **cardiovascular_outcomes_boundary**.

**Findings:**
- **population / GISSI-HF registry provenance:** Use for design/provenance, not standalone efficacy. Effect/direction: Registry anchor for symptomatic chronic heart-failure n-3 PUFA trial.

**Why it matters:** Keeps trial registration separate from clinical-result claims.

**Potential experiment signals:**
- mortality
- cardiovascular hospitalization
- trial registration provenance

**Protocol takeaway:** Do not cite registry for efficacy.

**Claim use:** `context-only`.

## Extraction details

- **Source kind:** trial_registry
- **Study design:** trial_registry
- **Participants:** 6975 (registry_or_linked_trial_reported)
- **Population:** patients with symptomatic chronic heart failure
- **Intervention/exposure:** oral n-3 PUFA and rosuvastatin factorial trial context
- **Comparator/control:** placebo
- **Duration/follow-up:** linked GISSI-HF follow-up about 3.9 years
- **Endpoints:** mortality, cardiovascular hospitalization, trial registration provenance
- **Effect or direction:** Registry anchor only; linked GISSI-HF publication supplies outcome evidence.
- **Adverse events/safety:** No registry-based adverse-event result extracted.
- **Population mismatch:** Symptomatic chronic heart failure, not general wellness users.
- **Directness:** `adjacent_variant`
- **Artifact rights status:** `unknown`

## Limitations

- Trial registry not result article.
- Heart-failure treatment population.
- Use for provenance only.
