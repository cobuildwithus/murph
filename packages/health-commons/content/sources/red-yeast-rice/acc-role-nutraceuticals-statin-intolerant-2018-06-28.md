---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:acc-role-nutraceuticals-statin-intolerant-2018-06-28"
slug: "sources/red-yeast-rice/acc-role-nutraceuticals-statin-intolerant-2018-06-28"
title: "The Role of Nutraceuticals in Statin Intolerant Patients"
summary: "ACC clinical education summary of a JACC expert review on nutraceuticals for statin-intolerant patients; red yeast rice is framed as a possible clinician-supervised option, with important caveats about limited safety data and product standardization."
status: "draft"
quality: "usable"
aliases:
  - "ACC 2018 nutraceuticals in statin intolerance"
  - "Rubenfire 2018 ACC nutraceutical summary"
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
  title: "The Role of Nutraceuticals in Statin Intolerant Patients"
  authors: "Melvyn Rubenfire, MD; American College of Cardiology"
  year: 2018
  journal: "American College of Cardiology"
  citation: "Rubenfire M. The Role of Nutraceuticals in Statin Intolerant Patients. American College of Cardiology. Published June 28, 2018. Summary of Banach M, Patti AM, Giglio RV, et al. J Am Coll Cardiol. 2018;72:96-118."
  url: "https://www.acc.org/latest-in-cardiology/articles/2018/06/28/13/09/the-role-of-nutraceuticals-in-statin-intolerant-patients"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    url: "https://www.acc.org/latest-in-cardiology/articles/2018/06/28/13/09/the-role-of-nutraceuticals-in-statin-intolerant-patients"
  canonicalUrl: "https://www.acc.org/latest-in-cardiology/articles/2018/06/28/13/09/the-role-of-nutraceuticals-in-statin-intolerant-patients"
researchEvidence:
  designKind: "other"
  designLabel: "Cardiology education summary of an expert review"
  populationLabel: "Clinicians managing patients with statin-associated muscle symptoms or statin intolerance"
  durationLabel: "Not applicable; web summary of an expert review"
  aggregateRole: "context"
  cohortKey: "acc-2018-nutraceuticals-statin-intolerant-summary"
  notes:
    - "No participant count is reported for this web summary; it summarizes a broader expert review."
evidenceBucket: "Interactions, contraindications, and population boundaries"
whyItMatters: "Places red yeast rice inside clinician-managed statin-intolerance decision-making rather than a self-directed substitute for evidence-based lipid care."
potentialMurphEndpoints:
  - "medication-intolerance-history"
  - "baseline LDL-C"
  - "clinician-review-required"
  - "product-standardization-risk"
protocolTakeaway: "Use as a safety/context boundary: red yeast rice may be discussed for selected statin-intolerant patients, but the ACC perspective warns that nutraceutical evidence, safety power, and standardization are not equivalent to established lipid drugs."
murphTakeaway: "Do not convert this ACC education page into a direct efficacy claim; use it to require clinician review and to flag statin-intolerance context and standardization concerns."
studyDesign: "Clinical education summary / expert commentary"
modality: "Red yeast rice as a nutraceutical option in statin-intolerant care"
directness: "same_mechanism"
claimUse: "safety-only"
sourceFindings:
  -
    findingId: "finding:acc-nutraceuticals-statin-intolerant-ryr-context"
    findingKind: "context"
    population: "Clinicians and patients considering nonstatin approaches after statin-associated muscle symptoms or statin intolerance"
    exposure: "Nutraceuticals including red yeast rice, phytosterols, bergamot, berberine, garlic, green tea, and others"
    outcome: "Clinical positioning of red yeast rice in statin-intolerant care"
    summary: "The ACC summary presents red yeast rice as one of several nutraceuticals that may be considered for some statin-intolerant patients, but only in a clinical decision framework rather than as an unsupervised replacement for standard therapies."
    evidenceUse:
      - "context"
      - "safety"
    sourceKey: "source_artifact:acc-role-nutraceuticals-statin-intolerant-2018-06-28"
  -
    findingId: "finding:acc-nutraceuticals-study-limitations-standardization"
    findingKind: "safety"
    population: "Patients using nutraceuticals for LDL-C lowering, especially those unable to tolerate statins"
    exposure: "Commercial nutraceutical products including red yeast rice"
    outcome: "Evidence and product-quality limitations"
    summary: "The ACC perspective flags that many nonstatin nutraceutical studies are underpowered for safety and efficacy and that product standardization is often unavailable, limiting translation to protocol claims."
    evidenceUse:
      - "safety"
      - "context"
    sourceKey: "source_artifact:acc-role-nutraceuticals-statin-intolerant-2018-06-28"
murphV1Priority: "High"
pdfRightsStatus: "unknown"
---
This source is included for **Interactions, contraindications, and population boundaries**.

**Findings:**
- `finding:acc-nutraceuticals-statin-intolerant-ryr-context` — The ACC summary presents red yeast rice as one of several nutraceuticals that may be considered for some statin-intolerant patients, but only in a clinical decision framework rather than as an unsupervised replacement for standard therapies.
- `finding:acc-nutraceuticals-study-limitations-standardization` — The ACC perspective flags that many nonstatin nutraceutical studies are underpowered for safety and efficacy and that product standardization is often unavailable, limiting translation to protocol claims.

**Why it matters:** Places red yeast rice inside clinician-managed statin-intolerance decision-making rather than a self-directed substitute for evidence-based lipid care.

**Potential experiment signals:** medication-intolerance-history, baseline LDL-C, clinician-review-required, product-standardization-risk.

**Protocol takeaway:** Use as a safety/context boundary: red yeast rice may be discussed for selected statin-intolerant patients, but the ACC perspective warns that nutraceutical evidence, safety power, and standardization are not equivalent to established lipid drugs.

**Limitations:** Secondary web summary of an expert review; not a trial; the ACC perspective explicitly notes underpowered safety/efficacy evidence and product-standardization problems.

**Population mismatch:** Applies to statin-intolerant or statin-associated muscle symptom populations, not necessarily to otherwise healthy self-experimenters using red yeast rice for cholesterol.

**Claim use:** `safety-only`.
