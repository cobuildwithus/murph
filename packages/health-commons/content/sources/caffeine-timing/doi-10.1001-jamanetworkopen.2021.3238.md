---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1001-jamanetworkopen.2021.3238
slug: sources/caffeine-timing/doi-10.1001-jamanetworkopen.2021.3238
title: Association Between Maternal Caffeine Consumption and Metabolism and Neonatal Anthropometry
summary: Biomarker-informed pregnancy cohort linking maternal caffeine/paraxanthine concentrations and self-reported intake with smaller neonatal anthropometric measures; context-only observational fetal-growth evidence.
status: draft
quality: usable
aliases:
- Gleason 2021 maternal caffeine neonatal anthropometry
- DOI 10.1001/jamanetworkopen.2021.3238
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: journal_article
  title: Association Between Maternal Caffeine Consumption and Metabolism and Neonatal Anthropometry
  authors: Jessica L. Gleason; Fasil Tekola-Ayele; Rajeshwari Sundaram; Stefanie N. Hinkle; Yassaman Vafai; Germaine M. Buck Louis; Nicole Gerlanc; Melissa Amyx; Alaina M. Bever; Melissa M. Smarr; Morgan Robinson; Kurunthachalam Kannan; Katherine L. Grantz
  year: 2021
  journal: JAMA Network Open
  citation: Gleason JL, Tekola-Ayele F, Sundaram R, et al. Association Between Maternal Caffeine Consumption and Metabolism and Neonatal Anthropometry. JAMA Netw Open. 2021;4(3):e213238. doi:10.1001/jamanetworkopen.2021.3238.
  doi: 10.1001/jamanetworkopen.2021.3238
  url: https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2777828
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1001/jamanetworkopen.2021.3238
    pmcid: PMC7994948
    titleHash: 626ed3986834f6e393cf73b2c03baecff978c1003d3dbfa2f223121ffc698c9b
    url: https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2777828
  canonicalUrl: https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2777828
researchEvidence:
  designKind: prospective_cohort
  designLabel: Longitudinal pregnancy cohort secondary analysis
  participantCount: 2055
  participantCountKind: reported
  populationLabel: Nonsmoking pregnant women at low risk for fetal growth abnormalities across 12 US clinical sites
  durationLabel: Early pregnancy biomarker/self-report assessment with neonatal anthropometry at birth
  aggregateRole: primary
  cohortKey: doi-10.1001-jamanetworkopen.2021.3238
extractionSummary:
  interventionOrExposure: Plasma caffeine and paraxanthine concentrations, self-reported caffeinated beverage consumption, and caffeine metabolism genotype context.
  comparatorOrControl: Lower biomarker or no reported caffeine intake categories.
  endpoints:
  - Birth weight
  - Birth length
  - Head circumference
  - Arm and thigh circumference
  - Skinfold measures
  - CYP1A2 metabolism genotype moderation
  effectEstimatesOrDirection: Higher plasma caffeine quartile and low self-reported intake around 50 mg/day were associated with smaller neonatal anthropometric measures; genotype did not materially change the associations in the reported analysis.
  adverseEventsOrSafetyNotes: Context-only observational fetal-growth safety signal; not a causal or timing-intervention study.
evidenceBucket: clinical_safety_boundaries
whyItMatters: Shows pregnancy caffeine exposure signals even at low reported intake using biomarkers, but still does not establish curfew efficacy or causality.
potentialMurphEndpoints:
- safety:pregnancy
- safety:fetal-growth
- biomarker:caffeine-concentration
protocolTakeaway: Pregnancy safety content should not imply that morning-only caffeine is automatically safe; exposure amount and clearance matter.
murphTakeaway: Use as biomarker-informed pregnancy context only.
studyDesign: cohort
modality: pregnancy observational cohort
claimUse: context-only
limitations: Observational secondary analysis; residual confounding possible; focused on pregnancy/neonatal anthropometry rather than adult sleep or curfew adherence.
populationMismatch: Pregnancy/neonatal cohort does not generalize to adult sleep optimization.
directnessToProtocol: Adjacent observational pregnancy context; not direct protocol evidence.
sourceFindings:
- findingId: finding:doi-10.1001-jamanetworkopen.2021.3238-caffeine-biomarker-anthropometry
  sourceKey: source_artifact:doi-10.1001-jamanetworkopen.2021.3238
  extractedFromArtifactId: art_doi_10_1001_jamanetworkopen_2021_3238_jama_html
  findingKind: context
  population: Nonsmoking pregnant women at low risk for fetal growth abnormalities
  exposure: Higher plasma caffeine and paraxanthine concentrations in early pregnancy
  outcome: Neonatal anthropometry
  summary: Higher maternal caffeine and paraxanthine biomarker concentrations were associated with smaller neonatal anthropometric measures, including lower birth weight and smaller body-size measures.
  evidenceUse:
  - context
  - safety
- findingId: finding:doi-10.1001-jamanetworkopen.2021.3238-low-reported-intake-context
  sourceKey: source_artifact:doi-10.1001-jamanetworkopen.2021.3238
  extractedFromArtifactId: art_doi_10_1001_jamanetworkopen_2021_3238_jama_html
  findingKind: context
  population: Nonsmoking pregnant women at low risk for fetal growth abnormalities
  exposure: Self-reported caffeinated beverage consumption around 50 mg/day versus none
  outcome: Neonatal anthropometry
  summary: Low self-reported caffeine intake was associated with smaller neonatal anthropometric measures, but the observational design prevents causal interpretation.
  evidenceUse:
  - context
  - safety
- findingId: finding:doi-10.1001-jamanetworkopen.2021.3238-genotype-no-difference
  sourceKey: source_artifact:doi-10.1001-jamanetworkopen.2021.3238
  extractedFromArtifactId: art_doi_10_1001_jamanetworkopen_2021_3238_jama_html
  findingKind: context
  population: Pregnant cohort with caffeine metabolism genotype data
  exposure: Fast versus slow caffeine metabolism genotype context
  outcome: Neonatal anthropometry associations
  summary: Reported associations did not materially differ by the studied fast/slow caffeine metabolism genotype, preserving a null genotype-moderation finding.
  evidenceUse:
  - context
  - measurement
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **clinical_safety_boundaries**.

**Findings:**
- `finding:doi-10.1001-jamanetworkopen.2021.3238-caffeine-biomarker-anthropometry`: Higher maternal caffeine and paraxanthine biomarker concentrations were associated with smaller neonatal anthropometric measures, including lower birth weight and smaller body-size measures.
- `finding:doi-10.1001-jamanetworkopen.2021.3238-low-reported-intake-context`: Low self-reported caffeine intake was associated with smaller neonatal anthropometric measures, but the observational design prevents causal interpretation.
- `finding:doi-10.1001-jamanetworkopen.2021.3238-genotype-no-difference`: Reported associations did not materially differ by the studied fast/slow caffeine metabolism genotype, preserving a null genotype-moderation finding.

**Why it matters:** Shows pregnancy caffeine exposure signals even at low reported intake using biomarkers, but still does not establish curfew efficacy or causality.

**Potential experiment signals:**
- safety:pregnancy
- safety:fetal-growth
- biomarker:caffeine-concentration

**Protocol takeaway:** Pregnancy safety content should not imply that morning-only caffeine is automatically safe; exposure amount and clearance matter.

**Claim use:** `context-only`.
