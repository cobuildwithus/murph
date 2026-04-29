---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct00936364
slug: sources/prolonged-fasting/clinicaltrials-nct00936364
title: 'Short-Term Fasting: Impact on Toxicity'
summary: 'Short-Term Fasting: Impact on Toxicity is included as clinical/residential supervised fasting boundary: Use as oncology/supervision boundary only; do not treat as direct efficacy evidence for healthy prolonged fasting.'
status: draft
quality: usable
aliases:
- 'Short-Term Fasting: Impact on Toxicity'
- NCT00936364
categories:
- prolonged-fasting
relations:
- type: related_protocol
  target: protocol_variant:prolonged-fasting/prolonged-fasting-24-72-hours
- type: parent_family
  target: experiment_family:prolonged-fasting
source:
  kind: web_page
  title: 'Short-Term Fasting: Impact on Toxicity'
  authors: University of Southern California; ClinicalTrials.gov record
  year: 2009
  journal: ClinicalTrials.gov
  citation: 'University of Southern California; ClinicalTrials.gov record. Short-Term Fasting: Impact on Toxicity. ClinicalTrials.gov. 2009.'
  url: https://clinicaltrials.gov/study/NCT00936364
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: NCT00936364
    titleHash: 7b7bb055dcb3af0fa2cc6f112fffcc4add94c5ed0b301b22e51c06250973e79e
    url: https://clinicaltrials.gov/study/NCT00936364
  canonicalUrl: https://clinicaltrials.gov/study/NCT00936364
researchEvidence:
  designKind: other
  designLabel: trial registry; partially randomized pilot oncology supportive-care trial
  populationLabel: Patients with advanced solid tumors receiving platinum-based chemotherapy.
  durationLabel: Fasting around chemotherapy administration; available registry/search material indicates clinical chemotherapy-cycle timing rather than a wellness fast.
  aggregateRole: primary
  cohortKey: cohort:clinicaltrials-nct00936364
evidenceBucket: Clinical/residential supervised fasting boundary
whyItMatters: Shows that even 24–72 hour fasting-like interventions may be studied as medical supportive care when paired with chemotherapy, reinforcing supervision and population-boundary language.
potentialMurphEndpoints:
- adverse events
- chemotherapy toxicity
- feasibility
- safety
- population mismatch
protocolTakeaway: Use as oncology/supervision boundary only; do not treat as direct efficacy evidence for healthy prolonged fasting.
murphTakeaway: Use as oncology/supervision boundary only; do not treat as direct efficacy evidence for healthy prolonged fasting.
studyDesign: trial registry; partially randomized pilot oncology supportive-care trial
modality: short-term fasting around chemotherapy
claimUse: context-only
sourceFindings:
- findingId: finding:clinicaltrials-nct00936364-01
  sourceKey: source_artifact:clinicaltrials-nct00936364
  extractedFromArtifactId: art_clinicaltrials_nct00936364
  findingKind: context
  population: Patients with advanced solid tumors receiving platinum-based chemotherapy
  exposure: Short-term fasting around platinum-based chemotherapy
  outcome: chemotherapy toxicity and feasibility
  summary: ClinicalTrials.gov registry context for short-term fasting to reduce chemotherapy toxicity; no registry-result extraction was available for direct protocol efficacy claims.
  evidenceUse:
  - context
  - safety
murphV1Priority: High
pdfRightsStatus: unknown
---

This source is included for **Clinical/residential supervised fasting boundary**.

**Findings:** ClinicalTrials.gov registry context for short-term fasting to reduce chemotherapy toxicity; no registry-result extraction was available for direct protocol efficacy claims.

**Why it matters:** Shows that even 24–72 hour fasting-like interventions may be studied as medical supportive care when paired with chemotherapy, reinforcing supervision and population-boundary language.

**Potential experiment signals:** adverse events, chemotherapy toxicity, feasibility, metabolic markers.

**Protocol takeaway:** Use as oncology/supervision boundary only; do not treat as direct efficacy evidence for healthy prolonged fasting.

**Claim use:** `context-only`.

## Extraction details

- **Population:** Patients with advanced solid tumors receiving platinum-based chemotherapy.
- **Intervention/exposure:** Short-term fasting around chemotherapy; oncology supportive-care setting.
- **Comparator/control:** Normal diet/usual eating comparator or alternate fasting schedules in the registered pilot.
- **Duration/follow-up:** Fasting around chemotherapy administration; available registry/search material indicates clinical chemotherapy-cycle timing rather than a wellness fast.
- **Endpoints:** chemotherapy toxicity, safety, feasibility, metabolic markers
- **Effect estimate or direction:** Registry context only; no registry-result extraction performed from the source page draft.
- **Adverse events/safety notes:** Safety and chemotherapy toxicity were primary registry concerns; no source-owned adverse-event rates extracted from the registry record draft.
- **Limitations:** Trial-registry source; oncology population, chemotherapy co-intervention, and clinical setting do not generalize to healthy self-directed fasting.
- **Population mismatch:** Advanced solid tumor chemotherapy population; direct wellness-protocol applicability is low.
- **Directness to Prolonged Fasting (24–72 Hours):** clinical_supervised
- **Artifact/rights note:** No copyrighted PDF is stored in Git for this draft. Rights status: `unknown`.
