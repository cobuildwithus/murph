---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1016-j.jff.2023.105878"
slug: "sources/psyllium-husk/doi-10.1016-j.jff.2023.105878"
title: "The beneficial effects of psyllium on cardiovascular diseases and their risk factors: Systematic review and dose-response meta-analysis of randomized controlled trials"
summary: "Psyllium-specific RCT meta-analysis and dose-response synthesis reporting lower LDL-C and total cholesterol, with broader cardiometabolic markers also assessed."
status: "draft"
quality: "usable"
aliases:
  - "doi-10.1016-j.jff.2023.105878"
  - "10.1016/j.jff.2023.105878"
categories:
  - "psyllium-husk"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:psyllium-husk"
source:
  kind: "review"
  title: "The beneficial effects of psyllium on cardiovascular diseases and their risk factors: Systematic review and dose-response meta-analysis of randomized controlled trials"
  authors: "Zeinab Gholami, Zamzam Paknahad"
  year: 2023
  journal: "Journal of Functional Foods"
  citation: "Gholami Z, Paknahad Z. The beneficial effects of psyllium on cardiovascular diseases and their risk factors: Systematic review and dose-response meta-analysis of randomized controlled trials. Journal of Functional Foods. 2023;111:105878. doi:10.1016/j.jff.2023.105878"
  doi: "10.1016/j.jff.2023.105878"
  url: "https://www.sciencedirect.com/science/article/pii/S1756464623004784"
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.1016/j.jff.2023.105878"
    url: "https://www.sciencedirect.com/science/article/pii/S1756464623004784"
  canonicalUrl: "https://www.sciencedirect.com/science/article/pii/S1756464623004784"
  identityAliases:
    - "doi-10.1016-j.jff.2023.105878"
    - "10.1016/j.jff.2023.105878"
researchEvidence:
  designKind: "meta_analysis"
  designLabel: "Systematic review and dose-response meta-analysis of randomized controlled trials"
  participantCount: 4100
  participantCountKind: "reported"
  includedStudyCount: 61
  populationLabel: "Adults in randomized controlled trials evaluating psyllium for cardiovascular risk factors; populations varied across included trials."
  durationLabel: "Varied across included randomized trials."
  aggregateRole: "synthesis"
  cohortKey: "psyllium-cvd-risk-rct-meta-analysis-61-trials"
  notes:
    - "Batch batch-001: Merged 2 candidate rows from 02-discovery-direct-psy-ldl-meta, 04-discovery-dose-formulation-timing. Discovery rationale: Psyllium-specific dose-response synthesis across cardiovascular risk markers; lipid outcomes are relevant but broader than this shard."
    - "Artifact extraction source: art_doi_10_1016_j_jff_2023_105878_html."
evidenceBucket: "Direct protocol synthesis and dose-response evidence"
whyItMatters: "This is a direct psyllium synthesis covering LDL-C and related cardiovascular risk markers, making it a backbone source for dose-response expectations while remaining broader than a cholesterol-only protocol."
potentialMurphEndpoints:
  - "LDL-C"
  - "total cholesterol"
  - "HDL-C"
  - "triglycerides"
  - "fasting blood sugar"
  - "HbA1c"
  - "systolic blood pressure"
  - "body weight"
protocolTakeaway: "Use as direct synthesis evidence that psyllium can lower LDL-C and total cholesterol across RCTs; keep broader cardiometabolic findings separate from the cholesterol claim."
murphTakeaway: "For a home cholesterol experiment, prioritize fasting LDL-C and total cholesterol before extending claims to glucose, blood pressure, or body weight."
studyDesign: "Systematic review and dose-response meta-analysis of randomized controlled trials"
modality: "Psyllium supplementation; dose and formulation varied across randomized trials."
directness: "direct_protocol"
claimUse: "supports-protocol"
populationMismatch: "Low-to-moderate mismatch: trials were adult RCTs but not all participants were necessarily using psyllium specifically for hypercholesterolemia."
limitations:
  - "Broad cardiovascular-risk-factor scope rather than cholesterol-only scope."
  - "Trial dose, duration, and population heterogeneity limit single-protocol precision."
  - "Weight effect was not directionally favorable in the reported pooled estimate and should not be converted into a weight-loss claim."
safetyNotes: "Adverse-event extraction was not the central source role for this batch item; use dedicated safety records for tolerability claims."
sourceFindings:

  -
    findingId: "finding:doi-10.1016-j.jff.2023.105878-ldl-total-cholesterol-dose-response"
    sourceKey: "source_artifact:doi-10.1016-j.jff.2023.105878"
    extractedFromArtifactId: "art_doi_10_1016_j_jff_2023_105878_html"
    findingKind: "intervention_result"
    population: "Adults in 61 randomized controlled trials included in a psyllium cardiovascular-risk-factor synthesis."
    exposure: "Psyllium supplementation; dose-response analyses across varying doses and formulations."
    outcome: "LDL-C and total cholesterol."
    summary: "The pooled analysis reported lower LDL-C (weighted mean difference about -8.55 mg/dL) and lower total cholesterol (about -9.05 mg/dL) with psyllium versus control."
    evidenceUse:
      - "efficacy"
  -
    findingId: "finding:doi-10.1016-j.jff.2023.105878-broader-cvd-risk-markers"
    sourceKey: "source_artifact:doi-10.1016-j.jff.2023.105878"
    extractedFromArtifactId: "art_doi_10_1016_j_jff_2023_105878_html"
    findingKind: "context"
    population: "Adults across psyllium RCTs with varied cardiometabolic risk profiles."
    exposure: "Psyllium supplementation compared with control."
    outcome: "Glucose, HbA1c, systolic blood pressure, HOMA-IR, and body weight."
    summary: "The synthesis also reported reductions in fasting blood sugar, HbA1c, systolic blood pressure, and HOMA-IR, while body weight increased in the pooled estimate; these are context outcomes, not primary cholesterol claims."
    evidenceUse:
      - "context"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
---
This source is included for **Direct protocol synthesis and dose-response evidence**.

## Source extraction notes

**Findings:** The pooled analysis reported lower LDL-C (weighted mean difference about -8.55 mg/dL) and lower total cholesterol (about -9.05 mg/dL) with psyllium versus control. The synthesis also reported reductions in fasting blood sugar, HbA1c, systolic blood pressure, and HOMA-IR, while body weight increased in the pooled estimate; these are context outcomes, not primary cholesterol claims.

**Why it matters:** This is a direct psyllium synthesis covering LDL-C and related cardiovascular risk markers, making it a backbone source for dose-response expectations while remaining broader than a cholesterol-only protocol.

**Potential experiment signals:** LDL-C; total cholesterol; HDL-C; triglycerides; fasting blood sugar; HbA1c; systolic blood pressure; body weight.

**Protocol takeaway:** Use as direct synthesis evidence that psyllium can lower LDL-C and total cholesterol across RCTs; keep broader cardiometabolic findings separate from the cholesterol claim.

**Claim use:** `supports-protocol`.

## Evidence boundary

- **Directness:** `direct_protocol`.
- **Population mismatch:** Low-to-moderate mismatch: trials were adult RCTs but not all participants were necessarily using psyllium specifically for hypercholesterolemia.
- **Limitations:** Broad cardiovascular-risk-factor scope rather than cholesterol-only scope. Trial dose, duration, and population heterogeneity limit single-protocol precision. Weight effect was not directionally favorable in the reported pooled estimate and should not be converted into a weight-loss claim.
- **Safety notes:** Adverse-event extraction was not the central source role for this batch item; use dedicated safety records for tolerability claims.
- **Artifact rights:** `open_access`; candidate artifact `art_doi_10_1016_j_jff_2023_105878_html` is metadata/link-only unless rights review clears redistribution.
