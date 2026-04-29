---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:eur-lex-regulation-2022-860-monacolins-red-yeast-rice-2022-06-01"
slug: "sources/red-yeast-rice/eur-lex-regulation-2022-860-monacolins-red-yeast-rice-2022-06-01"
title: "Commission Regulation (EU) 2022/860 of 1 June 2022 amending Annex III to Regulation (EC) No 1925/2006 as regards monacolins from red yeast rice"
summary: "EU regulation restricting monacolins from red yeast rice and requiring label information and warnings for products containing them."
status: "draft"
quality: "usable"
aliases:
  - "EU 2022 monacolins restriction for red yeast rice"
categories:
  - "red-yeast-rice"
  - "regulatory"
  - "safety"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "guideline"
  title: "Commission Regulation (EU) 2022/860 of 1 June 2022 amending Annex III to Regulation (EC) No 1925/2006 as regards monacolins from red yeast rice"
  authors: "European Commission"
  year: 2022
  journal: "Official Journal of the European Union"
  citation: "European Commission. Commission Regulation (EU) 2022/860 of 1 June 2022 amending Annex III to Regulation (EC) No 1925/2006 as regards monacolins from red yeast rice. Official Journal of the European Union. 2022."
  url: "https://eur-lex.europa.eu/eli/reg/2022/860/oj"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "c1b916590d8a0c8053e70fd93d46a4fdd2f19f09683e91ddf2d773c45b0ffdbb"
    url: "https://eur-lex.europa.eu/eli/reg/2022/860/oj"
  canonicalUrl: "https://eur-lex.europa.eu/eli/reg/2022/860/oj"
researchEvidence:
  designKind: "guideline"
  designLabel: "Regulation / monacolin restriction"
  populationLabel: "Foods and food supplements containing monacolins from red yeast rice in the EU market."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "eur-lex-regulation-2022-860-monacolins-red-yeast-rice-2022-06-01"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Establishes that product dose and label warnings are central to legality and safety for red yeast rice protocols in EU-aligned jurisdictions."
potentialMurphEndpoints:
  - "monacolin K per daily serving"
  - "warning-label presence"
  - "muscle symptoms"
  - "liver-safety symptoms"
protocolTakeaway: "A protocol should not treat “red yeast rice” as a uniform exposure; monacolin amount and jurisdiction-specific legality must be tracked."
murphTakeaway: "A Murph experiment should log monacolin content per daily dose and region; otherwise LDL outcomes and safety events are uninterpretable."
studyDesign: "Regulation / monacolin restriction"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:

  -
    findingKind: "safety"
    population: "EU foods and supplements containing monacolins from red yeast rice"
    exposure: "Monacolins from red yeast rice"
    outcome: "Regulatory dose restriction and label warnings"
    summary: "Commission Regulation (EU) 2022/860 restricts monacolins from red yeast rice by requiring daily-consumption portions to provide less than 3 mg and by requiring monacolin-content information and warnings on labels."
    evidenceUse:
      - "safety"
      - "context"
    findingId: "finding:eur-lex-regulation-2022-860-monacolins-red-yeast-rice-2022-06-01-monacolin-restriction"
    sourceKey: "source_artifact:eur-lex-regulation-2022-860-monacolins-red-yeast-rice-2022-06-01"
    extractedFromArtifactId: "art_eur_lex_regulation_2022_860_monacolins_red_yeast_rice_2022_06_01_html"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
artifacts:

  -
    artifactId: "art_eur_lex_regulation_2022_860_monacolins_red_yeast_rice_2022_06_01_html"
    sourceKey: "source_artifact:eur-lex-regulation-2022-860-monacolins-red-yeast-rice-2022-06-01"
    kind: "html"
    storage: "external"
    sourceUrl: "https://eur-lex.europa.eu/eli/reg/2022/860/oj"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Foods and food supplements containing monacolins from red yeast rice in the EU market."
  interventionOrExposure: "Daily intake of monacolins from red yeast rice."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "monacolin daily amount"
    - "label warning boundary"
    - "product eligibility for sale"
  effectEstimatesOrDirection: "Individual portions recommended for daily consumption must provide less than 3 mg of monacolins from red yeast rice and labels must disclose monacolin content with warnings."
  adverseEventsOrSafetyNotes: "Regulation was triggered by EFSA safety concerns for monacolins, including adverse events reported at low intakes."
  limitations: "Regulatory risk-management rule; it does not estimate cholesterol response at compliant doses."
  populationMismatch: "Regulatory, product-quality, or safety context; not a Murph self-experiment cohort."
  directnessToProtocol: "general_guideline"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** EU regulation restricting monacolins from red yeast rice and requiring label information and warnings for products containing them.

**Why it matters:** Establishes that product dose and label warnings are central to legality and safety for red yeast rice protocols in EU-aligned jurisdictions.

**Potential experiment signals:** monacolin K per daily serving, warning-label presence, muscle symptoms, liver-safety symptoms.

**Protocol takeaway:** A protocol should not treat “red yeast rice” as a uniform exposure; monacolin amount and jurisdiction-specific legality must be tracked.

**Claim use:** `safety-only`.
