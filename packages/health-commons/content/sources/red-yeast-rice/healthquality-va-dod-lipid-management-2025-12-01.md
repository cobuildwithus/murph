---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:healthquality-va-dod-lipid-management-2025-12-01"
slug: "sources/red-yeast-rice/healthquality-va-dod-lipid-management-2025-12-01"
title: "VA/DoD Clinical Practice Guideline for the Management of Dyslipidemia for Cardiovascular Risk Reduction"
summary: "Clinical guideline context stating insufficient evidence to recommend for or against RYR supplements for reducing cardiovascular risks, with low confidence and interaction cautions."
status: "draft"
quality: "usable"
aliases:
  - "U.S. Department of Veterans Affairs 2025: VA/DoD Clinical Practice Guideline for the Management of Dyslipidemia for Cardiovascular Risk Reduction"
  - "VA/DoD Clinical Practice Guideline for the Management of Dyslipidemia for Cardiovascular Risk Reduction"
categories:
  - "red-yeast-rice"
  - "product-quality"
  - "contamination"
  - "dose-uncertainty"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "guideline"
  title: "VA/DoD Clinical Practice Guideline for the Management of Dyslipidemia for Cardiovascular Risk Reduction"
  authors: "U.S. Department of Veterans Affairs; U.S. Department of Defense"
  year: 2025
  journal: "VA/DoD Clinical Practice Guideline"
  citation: "U.S. Department of Veterans Affairs; U.S. Department of Defense. VA/DoD Clinical Practice Guideline for the Management of Dyslipidemia for Cardiovascular Risk Reduction. VA/DoD Clinical Practice Guideline. 2025."
  url: "https://www.healthquality.va.gov/guidelines/CD/lipids/"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "2ce6dbe01b36a9174b266f6f9125a574ca6aa4739f24c4b4b861008148c458c8"
    url: "https://www.healthquality.va.gov/guidelines/CD/lipids/"
  canonicalUrl: "https://www.healthquality.va.gov/guidelines/CD/lipids/"
researchEvidence:
  designKind: "guideline"
  designLabel: "Dyslipidemia clinical practice guideline"
  populationLabel: "Adults in VA/DoD dyslipidemia care context; guideline population, not an RYR trial cohort"
  durationLabel: "Guideline evidence review; recommendation carried forward/not reviewed as new"
  aggregateRole: "primary"
  cohortKey: "healthquality-va-dod-lipid-management-2025-12-01"
evidenceBucket: "Product quality, contamination, and dose uncertainty"
whyItMatters: "Prevents overstating RYR as a CVD-risk-reduction protocol rather than a supplement with uncertain patient-oriented benefit."
potentialMurphEndpoints:
  - "cardiovascular-risk reduction"
  - "patient-oriented benefit"
  - "supplement safety/interactions"
  - "evidence certainty"
protocolTakeaway: "Use as external guideline context and CV-outcome caveat, not as product-quality or LDL-C efficacy evidence."
murphTakeaway: "Use as external guideline context and CV-outcome caveat, not as product-quality or LDL-C efficacy evidence. It should shape product selection, monitoring, dose fidelity, or safety context without being treated as direct LDL-C efficacy evidence."
studyDesign: "Dyslipidemia clinical practice guideline"
modality: "Red yeast rice supplement quality/safety context"
claimUse: "safety-only"
sourceFindings:

  -
    findingId: "finding:healthquality-va-dod-lipid-management-2025-12-01:batch-003-primary"
    sourceKey: "source_artifact:healthquality-va-dod-lipid-management-2025-12-01"
    findingKind: "context"
    population: "Adults in VA/DoD dyslipidemia care context; guideline population, not an RYR trial cohort"
    exposure: "Fiber, garlic, ginger, green tea, and red yeast rice supplements as cardiovascular-risk-reduction adjuncts"
    outcome: "cardiovascular-risk reduction; patient-oriented benefit; supplement safety/interactions; evidence certainty"
    summary: "Recommendation 20 states there is insufficient evidence to recommend for or against red yeast rice supplements to reduce cardiovascular risk; confidence for RYR evidence was low."
    evidenceUse:
      - "context"
      - "safety"
murphV1Priority: "High"
pdfRightsStatus: "unknown"
---
This source is included for **Product quality, contamination, and dose uncertainty**.

**Findings:** Clinical guideline context stating insufficient evidence to recommend for or against RYR supplements for reducing cardiovascular risks, with low confidence and interaction cautions.

**Extracted details:**

- **Population / sample:** Adults in VA/DoD dyslipidemia care context; guideline population, not an RYR trial cohort
- **Intervention or exposure:** Fiber, garlic, ginger, green tea, and red yeast rice supplements as cardiovascular-risk-reduction adjuncts
- **Comparator / control:** Guideline comparison to evidence-based lipid therapies and patient-oriented outcomes
- **Duration / follow-up:** Guideline evidence review; recommendation carried forward/not reviewed as new
- **Endpoints:** cardiovascular-risk reduction; patient-oriented benefit; supplement safety/interactions; evidence certainty
- **Effect estimates or direction:** Recommendation 20 states there is insufficient evidence to recommend for or against red yeast rice supplements to reduce cardiovascular risk; confidence for RYR evidence was low.
- **Adverse events or safety notes:** Guideline notes possible interactions with other medications, especially cholesterol-lowering agents, and statin-like side effects including myopathy and transaminitis.
- **Limitations:** General CVD-risk guideline, not a product-quality market survey; the supplement recommendation was not newly reviewed in the 2025 update.
- **Population mismatch:** Guideline population and CV outcomes differ from short-term Murph cholesterol self-experiment endpoints.
- **Directness:** general_guideline context for cholesterol/CV claims

**Why it matters:** Prevents overstating RYR as a CVD-risk-reduction protocol rather than a supplement with uncertain patient-oriented benefit.

**Potential experiment signals:** cardiovascular-risk reduction; patient-oriented benefit; supplement safety/interactions; evidence certainty

**Protocol takeaway:** Use as external guideline context and CV-outcome caveat, not as product-quality or LDL-C efficacy evidence.

**Claim use:** `safety-only`.
