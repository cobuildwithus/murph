---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:fda-otc-monograph-m007-laxative-2023-05-02"
slug: "sources/psyllium-husk/fda-otc-monograph-m007-laxative-2023-05-02"
title: "OTC Monograph M007: Laxative Drug Products for Over-the-Counter Human Use"
summary: "Current FDA OTC monograph for laxative drug products identifying psyllium ingredients as bulk-forming laxative actives, while requiring choking warnings and liquid directions for dry or incompletely hydrated forms."
status: "draft"
quality: "usable"
aliases:
  - "OTC Monograph M007: Laxative Drug Products for Over-the-Counter Human Use"
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
  kind: "guideline"
  title: "OTC Monograph M007: Laxative Drug Products for Over-the-Counter Human Use"
  authors: "U.S. Food and Drug Administration"
  year: 2023
  journal: "FDA OTC Monographs"
  url: "https://www.accessdata.fda.gov/drugsatfda_docs/omuf/monographs/OTC%20Monograph_M007-Laxative%20Drug%20Products%20for%20OTC%20Human%20Use%2005.02.2023.pdf"
  citation: "U.S. Food and Drug Administration. (2023). OTC Monograph M007: Laxative Drug Products for Over-the-Counter Human Use. FDA OTC Monographs. https://www.accessdata.fda.gov/drugsatfda_docs/omuf/monographs/OTC%20Monograph_M007-Laxative%20Drug%20Products%20for%20OTC%20Human%20Use%2005.02.2023.pdf"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    url: "https://www.accessdata.fda.gov/drugsatfda_docs/omuf/monographs/OTC%20Monograph_M007-Laxative%20Drug%20Products%20for%20OTC%20Human%20Use%2005.02.2023.pdf"
  canonicalUrl: "https://www.accessdata.fda.gov/drugsatfda_docs/omuf/monographs/OTC%20Monograph_M007-Laxative%20Drug%20Products%20for%20OTC%20Human%20Use%2005.02.2023.pdf"
researchEvidence:
  designKind: "guideline"
  designLabel: "guideline"
  populationLabel: "OTC laxative users"
  durationLabel: "Monograph; no intervention follow-up."
  aggregateRole: "primary"
  cohortKey: "cohort:fda-otc-monograph-m007-laxative-2023-05-02:source-population"
  notes:
    - "Batch batch-005 extraction; claim use safety-only."
    - "Limitations: Regulatory monograph; no individual risk estimate.; Granular psyllium dosage forms are specifically treated as non-monograph unless approved separately."
    - "Population mismatch: OTC laxative framework rather than a cholesterol-lowering RCT."
evidenceBucket: "Safety, adverse events, and drug-interaction boundaries"
whyItMatters: "Current FDA OTC monograph source for bulk-forming laxative ingredients and class warnings relevant to psyllium products."
potentialMurphEndpoints:
  - "choking"
  - "hydration"
  - "dysphagia"
  - "adverse events"
protocolTakeaway: "Protocol safety text should align with the monograph’s full-glass directions and swallowing-difficulty boundary."
murphTakeaway: "Murph extraction should preserve this source as safety/context evidence and avoid promoting it into a direct LDL-C claim."
studyDesign: "guideline"
modality: "oral psyllium husk / ispaghula husk safety, tolerability, label, or adjacent context"
claimUse: "safety-only"
sourceFindings:

  -
    findingId: "finding:fda-otc-monograph-m007-laxative-2023-05-02-m007-psyllium-active"
    sourceKey: "source_artifact:fda-otc-monograph-m007-laxative-2023-05-02"
    extractedFromArtifactId: "art_fda_otc_monograph_m007_laxative_2023_05_02"
    findingKind: "context"
    population: "OTC laxative users."
    exposure: "Bulk-forming laxative ingredients including Plantago ovata husks, plantago seed, psyllium hydrophilic mucilloid, and related psyllium ingredients."
    outcome: "Ingredient classification."
    summary: "The monograph lists psyllium ingredients among bulk-forming laxative active ingredients, with granular psyllium dosage forms excluded under non-monograph conditions."
    evidenceUse:
      - "context"
      - "safety"
  -
    findingId: "finding:fda-otc-monograph-m007-laxative-2023-05-02-m007-choking-directions"
    sourceKey: "source_artifact:fda-otc-monograph-m007-laxative-2023-05-02"
    extractedFromArtifactId: "art_fda_otc_monograph_m007_laxative_2023_05_02"
    findingKind: "safety"
    population: "Users of dry or incompletely hydrated bulk-forming oral products."
    exposure: "Psyllium-class bulk-forming laxative products taken with liquid."
    outcome: "Choking and esophageal obstruction warnings."
    summary: "The monograph requires choking warnings and directions to take or mix the product with at least 8 ounces/full glass of water or other fluid."
    evidenceUse:
      - "safety"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
interventionOrExposure: "Bulk-forming laxative ingredients including psyllium seed/husk preparations"
comparatorOrControl: "Not applicable or not extracted for this safety/context source."
durationOrFollowUp: "Monograph; no intervention follow-up."
endpoints:
  - "choking"
  - "hydration"
  - "dysphagia"
  - "adverse events"
adverseEventsOrSafetyNotes:
  - "The monograph requires choking warnings and directions to take or mix the product with at least 8 ounces/full glass of water or other fluid."
limitations:
  - "Regulatory monograph; no individual risk estimate."
  - "Granular psyllium dosage forms are specifically treated as non-monograph unless approved separately."
populationMismatch: "OTC laxative framework rather than a cholesterol-lowering RCT."
directnessToProtocol: "general_guideline"
---
This source is included for **Safety, adverse events, and drug-interaction boundaries**.

**Findings:**

- `finding:fda-otc-monograph-m007-laxative-2023-05-02-m007-psyllium-active` — The monograph lists psyllium ingredients among bulk-forming laxative active ingredients, with granular psyllium dosage forms excluded under non-monograph conditions.
- `finding:fda-otc-monograph-m007-laxative-2023-05-02-m007-choking-directions` — The monograph requires choking warnings and directions to take or mix the product with at least 8 ounces/full glass of water or other fluid.

**Why it matters:** Current FDA OTC monograph source for bulk-forming laxative ingredients and class warnings relevant to psyllium products.

**Potential experiment signals:**

- choking
- hydration
- dysphagia
- adverse events

**Protocol takeaway:** Protocol safety text should align with the monograph’s full-glass directions and swallowing-difficulty boundary.

**Limitations and population mismatch:** Regulatory monograph; no individual risk estimate.; Granular psyllium dosage forms are specifically treated as non-monograph unless approved separately. Population mismatch: OTC laxative framework rather than a cholesterol-lowering RCT.

**Claim use:** `safety-only`.
