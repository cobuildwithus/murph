---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:drugs-com-red-yeast-rice-2025-05-14"
slug: "sources/red-yeast-rice/drugs-com-red-yeast-rice-2025-05-14"
title: "Red Yeast Rice Uses, Benefits & Dosage"
summary: "Drugs.com natural-products monograph summarizing red yeast rice dosing, statin-like pharmacology, pregnancy/lactation avoidance, interaction concerns, adverse effects, and product-quality risks."
status: "draft"
quality: "usable"
aliases:
  - "Drugs.com red yeast rice monograph"
  - "Red Yeast Rice Uses Benefits Dosage"
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
  title: "Red Yeast Rice Uses, Benefits & Dosage"
  authors: "Drugs.com Natural Products Database; Wolters Kluwer Health"
  year: 2025
  journal: "Drugs.com Natural Products Monograph"
  citation: "Drugs.com. Red Yeast Rice Uses, Benefits & Dosage. Natural Products Database. Last updated May 14, 2025."
  url: "https://www.drugs.com/npp/red-yeast-rice.html"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "0272d9d8ba6dc0259626f32c400d84f7639366443097fa0736707925d053e45e"
    url: "https://www.drugs.com/npp/red-yeast-rice.html"
  canonicalUrl: "https://www.drugs.com/npp/red-yeast-rice.html"
researchEvidence:
  designKind: "narrative_review"
  designLabel: "Natural-products clinical monograph"
  populationLabel: "Consumers and clinicians evaluating red yeast rice supplements"
  durationLabel: "Monograph; trial-dose examples include 4 to 12 weeks but safety guidance is not a trial"
  aggregateRole: "context"
  cohortKey: "drugs-com-2025-red-yeast-rice-monograph"
  notes:
    - "No participant count is reported for the monograph itself."
evidenceBucket: "Interactions, contraindications, and population boundaries"
whyItMatters: "Provides consumer-facing but clinically specific guardrails for medication review, pregnancy/lactation, statin-like myopathy risk, and supplement-quality concerns."
potentialMurphEndpoints:
  - "pregnancy-lactation-screen"
  - "medication-interaction-screen"
  - "history-of-statin-myopathy"
  - "ALT/AST"
  - "CK"
  - "kidney-function"
  - "citrinin-product-quality-risk"
protocolTakeaway: "Use as a safety boundary: exclude or require clinician review for pregnancy/lactation, prior statin-induced myopathy, interacting medications, liver/kidney risk, or uncertain product quality."
murphTakeaway: "This monograph supports onboarding guardrails and adverse-event monitoring, not protocol efficacy claims."
studyDesign: "Narrative natural-products monograph"
modality: "Red yeast rice supplement / monacolin K exposure"
directness: "general_guideline"
claimUse: "safety-only"
sourceFindings:

  -
    findingId: "finding:drugs-com-ryr-pregnancy-lactation-avoidance"
    findingKind: "safety"
    population: "Pregnant or lactating people considering red yeast rice"
    exposure: "Red yeast rice supplement exposure"
    outcome: "Pregnancy and lactation safety boundary"
    summary: "The monograph advises avoiding red yeast rice during pregnancy and lactation, making pregnancy/lactation an exclusion or clinician-review condition for protocol use."
    evidenceUse:
      - "safety"
    sourceKey: "source_artifact:drugs-com-red-yeast-rice-2025-05-14"
  -
    findingId: "finding:drugs-com-ryr-interaction-boundaries"
    findingKind: "safety"
    population: "People using red yeast rice who also take prescription or over-the-counter medicines"
    exposure: "Red yeast rice with narrow-therapeutic-index drugs, statins, fibrates, cyclosporine, CYP3A4 inhibitors, grapefruit, fusidic acid, or other interaction-relevant exposures"
    outcome: "Drug-interaction and myopathy-risk boundary"
    summary: "The monograph flags statin-like interaction concerns, including avoidance or caution with drugs that increase myopathy risk or affect lovastatin-like metabolism and transport."
    evidenceUse:
      - "safety"
    sourceKey: "source_artifact:drugs-com-red-yeast-rice-2025-05-14"
  -
    findingId: "finding:drugs-com-ryr-product-variability-adulteration"
    findingKind: "safety"
    population: "Consumers using commercial red yeast rice products"
    exposure: "Commercial red yeast rice supplements with variable monacolin K and potential contaminants/adulterants"
    outcome: "Product-quality and dose-translation risk"
    summary: "The monograph describes variable monacolin K content, possible adulteration, and citrinin/toxic-substance concerns, limiting dose generalization from labeled products."
    evidenceUse:
      - "safety"
      - "context"
    sourceKey: "source_artifact:drugs-com-red-yeast-rice-2025-05-14"
murphV1Priority: "High"
pdfRightsStatus: "unknown"
---
This source is included for **Interactions, contraindications, and population boundaries**.

**Findings:**
- `finding:drugs-com-ryr-pregnancy-lactation-avoidance` — The monograph advises avoiding red yeast rice during pregnancy and lactation, making pregnancy/lactation an exclusion or clinician-review condition for protocol use.
- `finding:drugs-com-ryr-interaction-boundaries` — The monograph flags statin-like interaction concerns, including avoidance or caution with drugs that increase myopathy risk or affect lovastatin-like metabolism and transport.
- `finding:drugs-com-ryr-product-variability-adulteration` — The monograph describes variable monacolin K content, possible adulteration, and citrinin/toxic-substance concerns, limiting dose generalization from labeled products.

**Why it matters:** Provides consumer-facing but clinically specific guardrails for medication review, pregnancy/lactation, statin-like myopathy risk, and supplement-quality concerns.

**Potential experiment signals:** pregnancy-lactation-screen, medication-interaction-screen, history-of-statin-myopathy, ALT/AST, CK, kidney-function, citrinin-product-quality-risk.

**Protocol takeaway:** Use as a safety boundary: exclude or require clinician review for pregnancy/lactation, prior statin-induced myopathy, interacting medications, liver/kidney risk, or uncertain product quality.

**Limitations:** Monograph evidence is summarized rather than source-extracted trial-by-trial; product composition and adulteration concerns limit transferability from trials to commercial supplements.

**Population mismatch:** General consumer/clinical reference; not specific to one standardized red yeast rice product or to the Murph protocol dose.

**Claim use:** `safety-only`.
