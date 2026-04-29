---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:sccm-heat-stroke-guideline-2025-02-22
slug: sources/dry-sauna/sccm-heat-stroke-guideline-2025-02-22
title: Guideline for the Treatment of Heat Stroke
summary: 'safety-only source for Safety, heat illness, medications, pregnancy, alcohol, older-adult risk: Use for emergency boundary language: severe heat symptoms require rapid cooling and medical care, not protocol continuation.'
status: draft
quality: usable
aliases:
- sccm-heat-stroke-guideline-2025-02-22
- Guideline for the Treatment of Heat Stroke
categories:
- dry-sauna
- safety
relations:
- type: related_protocol
  target: protocol_variant:dry-sauna/bryan-johnson-blueprint
- type: parent_family
  target: experiment_family:dry-sauna
source:
  kind: guideline
  title: Guideline for the Treatment of Heat Stroke
  authors: Jeffrey F. Barletta; Tina L. Palmieri; Shari A. Toomey; Fayez Alshamsi; Rebecca L. Stearns; Asad E. Patanwala; Nicole F. Siparsky; Neeraj Badjatia; Brian Schultz; Crystal M. Breighner; Eric Bruno; Christopher G. Harrod; Tanya Trevilian; Leandro Braz De Carvalho; James Houser; John M. Harahus; Yang Liu; Ryan Swoboda; Paulin Ruhato Banguti; Heatherlee Bailey
  year: 2025
  journal: Critical Care Medicine / Society of Critical Care Medicine
  citation: Barletta JF, Palmieri TL, Toomey SA, et al. Society of Critical Care Medicine guideline for the treatment of heat stroke. Crit Care Med. 2025;53(2):e490-e500. doi:10.1097/CCM.0000000000006551.
  doi: 10.1097/CCM.0000000000006551
  url: https://www.sccm.org/clinical-resources/guidelines/guidelines/guideline-for-the-treatment-of-heat-stroke
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    doi: 10.1097/CCM.0000000000006551
    titleHash: 7ea2cbf42a6f0db90b9e45c7d3ce0451b94a43cfe427e8e000dcb6c4f381b760
    url: https://www.sccm.org/clinical-resources/guidelines/guidelines/guideline-for-the-treatment-of-heat-stroke
  canonicalUrl: https://www.sccm.org/clinical-resources/guidelines/guidelines/guideline-for-the-treatment-of-heat-stroke
researchEvidence:
  designKind: guideline
  designLabel: Society of Critical Care Medicine clinical practice guideline
  populationLabel: Patients with heat stroke in prehospital, emergency, and critical-care contexts
  durationLabel: Guideline published February 22, 2025; not a participant follow-up study
  aggregateRole: synthesis
  cohortKey: cohort:sccm-heat-stroke-guideline-2025-02-22
evidenceBucket: Safety, heat illness, medications, pregnancy, alcohol, older-adult risk
whyItMatters: Most recent clinical guideline in the batch for heat-stroke treatment and cooling boundaries.
potentialMurphEndpoints:
- cooling rate
- time to target temperature
- heat-stroke treatment
- temperature-control medications
protocolTakeaway: 'Use for emergency boundary language: severe heat symptoms require rapid cooling and medical care, not protocol continuation.'
murphTakeaway: Do not frame suspected heat stroke as a self-managed experiment outcome.
studyDesign: Society of Critical Care Medicine clinical practice guideline
modality: Heat-stroke clinical management guideline
claimUse: safety-only
sourceFindings:
- findingId: finding:sccm-2025-heat-stroke-treatment
  sourceKey: source_artifact:sccm-heat-stroke-guideline-2025-02-22
  extractedFromArtifactId: art_sccm_heat_stroke_guideline_2025_02_22_web
  findingKind: safety
  population: Patients with heat stroke in prehospital, emergency, and critical-care contexts
  exposure: Heat stroke recognition and treatment; active cooling modalities and medication recommendations
  outcome: cooling rate; time to target temperature; heat-stroke treatment; temperature-control medications
  summary: The SCCM 2025 guideline recommends active cooling over passive cooling for heat stroke, prioritizes rapid cooling modalities, and advises against dantrolene and routine antipyretic-style drugs for temperature control.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: unknown
---

This source is included for **Safety, heat illness, medications, pregnancy, alcohol, older-adult risk**.

**Findings:** The SCCM 2025 guideline recommends active cooling over passive cooling for heat stroke, prioritizes rapid cooling modalities, and advises against dantrolene and routine antipyretic-style drugs for temperature control.

**Why it matters:** Most recent clinical guideline in the batch for heat-stroke treatment and cooling boundaries.

**Potential experiment signals:** cooling rate, time to target temperature, heat-stroke treatment, temperature-control medications.

**Protocol takeaway:** Use for emergency boundary language: severe heat symptoms require rapid cooling and medical care, not protocol continuation.

**Claim use:** `safety-only`.

## Extraction notes

- **Population:** Patients with heat stroke in prehospital, emergency, and critical-care contexts
- **Exposure/intervention:** Heat stroke recognition and treatment; active cooling modalities and medication recommendations
- **Comparator/control:** Active versus passive cooling modalities and medication approaches where evidence was reviewed
- **Duration/follow-up:** Guideline published February 22, 2025; not a participant follow-up study
- **Endpoints:** cooling rate, time to target temperature, heat-stroke treatment, temperature-control medications
- **Effect/direction:** The guideline recommends active cooling over passive cooling, prioritizes cold- or ice-water immersion where available, and recommends against dantrolene and routine antipyretic-style temperature-control medications for heat stroke.
- **Adverse events/safety notes:** Heat stroke is a medical emergency; pharmacologic fever treatments are not a substitute for rapid cooling.
- **Limitations:** Critical-care heat-stroke guideline rather than prevention guidance for sauna self-experiments.
- **Population mismatch:** Clinical heat-stroke treatment population rather than healthy sauna users.
- **Directness to Bryan Johnson Sauna:** general_guideline
- **Artifact candidates / rights:** Primary extraction artifact `art_sccm_heat_stroke_guideline_2025_02_22_web`; rights status `unknown`; no copyrighted PDF should be committed unless redistribution is verified.
