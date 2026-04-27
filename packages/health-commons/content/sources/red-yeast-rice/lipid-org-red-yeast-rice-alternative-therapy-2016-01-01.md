---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:lipid-org-red-yeast-rice-alternative-therapy-2016-01-01"
slug: "sources/red-yeast-rice/lipid-org-red-yeast-rice-alternative-therapy-2016-01-01"
title: "Red Yeast Rice as an Alternative Therapy for Hyperlipidemia"
summary: "National Lipid Association educational review summarizing red yeast rice efficacy context while emphasizing unregulated product variability, citrinin concerns, serious adverse-event reports, and need for close monitoring."
status: "draft"
quality: "usable"
aliases:
  - "NLA LipidSpin red yeast rice alternative therapy"
  - "Gordon Becker red yeast rice 2016"
categories:
  - "red-yeast-rice"
  - "safety"
  - "pharmacovigilance"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "web_page"
  title: "Red Yeast Rice as an Alternative Therapy for Hyperlipidemia"
  authors: "Ram Y. Gordon; David J. Becker"
  year: 2016
  journal: "LipidSpin / National Lipid Association"
  citation: "Gordon RY, Becker DJ. Red Yeast Rice as an Alternative Therapy for Hyperlipidemia. LipidSpin, National Lipid Association. 2016."
  url: "https://www.lipid.org/lipid-spin/potpourri-2016/red-yeast-rice-alternative-therapy-hyperlipidemia"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    url: "https://www.lipid.org/lipid-spin/potpourri-2016/red-yeast-rice-alternative-therapy-hyperlipidemia"
  canonicalUrl: "https://www.lipid.org/lipid-spin/potpourri-2016/red-yeast-rice-alternative-therapy-hyperlipidemia"
researchEvidence:
  designKind: "narrative_review"
  designLabel: "Expert educational review"
  populationLabel: "People with hyperlipidemia, including statin-intolerant patients in summarized studies"
  durationLabel: "Narrative review of trials and safety/regulatory issues"
  aggregateRole: "context"
  cohortKey: "nla-lipidspin-red-yeast-rice-2016"
evidenceBucket: "Safety reviews and pharmacovigilance"
whyItMatters: "Balances patient-interest efficacy context with NLA-style caution about product standardization, citrinin, and clinician monitoring."
potentialMurphEndpoints:
  - "LDL-C context"
  - "muscle symptoms"
  - "objective myositis/CK context"
  - "citrinin/product-quality checks"
  - "clinician monitoring"
protocolTakeaway: "Use primarily as safety and external-protocol context: even favorable LDL-C summaries are paired with monitoring and product-quality concerns."
murphTakeaway: "The practical takeaway is not “red yeast rice is safe”; it is “if used at all, it requires product scrutiny and close monitoring.”"
studyDesign: "Expert narrative review / external protocol context"
modality: "Red yeast rice for hyperlipidemia"
directness: "general_guideline"
claimUse: "safety-only"
claimUseBoundary: "Contains efficacy summaries, but this batch uses it only for safety/product-quality and monitoring boundaries."
sourceFindings:
  -
    findingId: "finding:red-yeast-rice-batch-004-lipid-org-efficacy-context"
    sourceKey: "source_artifact:lipid-org-red-yeast-rice-alternative-therapy-2016-01-01"
    findingKind: "context"
    population: "Hyperlipidemia patients and statin-intolerant patients summarized in NLA review"
    exposure: "Red yeast rice preparations in trials and clinical experience"
    outcome: "LDL-C lowering and tolerability context"
    summary: "The article summarizes meta-analytic LDL-C reductions of roughly 21-30% and several statin-intolerance studies reporting LDL-C reductions with generally similar adverse-event or myalgia rates; this is adjacent efficacy/tolerability context, not a safety incidence source."
    evidenceUse:
      - "context"
      - "efficacy"
      - "safety"
  -
    findingId: "finding:red-yeast-rice-batch-004-lipid-org-product-quality"
    sourceKey: "source_artifact:lipid-org-red-yeast-rice-alternative-therapy-2016-01-01"
    findingKind: "safety"
    population: "Consumers buying over-the-counter red yeast rice products"
    exposure: "Unregulated red yeast rice supplements"
    outcome: "Monacolin variability and citrinin/adulterant risk"
    summary: "The review highlights concerns that over-the-counter products are unregulated, monacolin content varies, citrinin contamination may occur, and consumers cannot reliably know product content from labels."
    evidenceUse:
      - "safety"
      - "context"
  -
    findingId: "finding:red-yeast-rice-batch-004-lipid-org-monitoring"
    sourceKey: "source_artifact:lipid-org-red-yeast-rice-alternative-therapy-2016-01-01"
    findingKind: "safety"
    population: "Patients considering red yeast rice as an alternative lipid-lowering therapy"
    exposure: "Red yeast rice preparations"
    outcome: "Serious adverse-event reports and close-monitoring recommendation"
    summary: "The authors note serious reported reactions including myopathy, rhabdomyolysis, hepatotoxicity, and anaphylaxis, and argue for cautious use only with close monitoring until regulation and standardization improve."
    evidenceUse:
      - "safety"
murphV1Priority: "High"
pdfRightsStatus: "unknown"
---
This source is included for **Safety reviews and pharmacovigilance**.

**Findings:** The article summarizes meta-analytic LDL-C reductions of roughly 21-30% and several statin-intolerance studies reporting LDL-C reductions with generally similar adverse-event or myalgia rates; this is adjacent efficacy/tolerability context, not a safety incidence source.

**Why it matters:** Balances patient-interest efficacy context with NLA-style caution about product standardization, citrinin, and clinician monitoring.

**Potential experiment signals:** LDL-C context, muscle symptoms, objective myositis/CK context, citrinin/product-quality checks, clinician monitoring.

**Protocol takeaway:** Use primarily as safety and external-protocol context: even favorable LDL-C summaries are paired with monitoring and product-quality concerns.

**Claim use:** `safety-only`.
