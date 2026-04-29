---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:federalregister-psyllium-granular-dosage-forms-2007-03-29"
slug: "sources/psyllium-husk/federalregister-psyllium-granular-dosage-forms-2007-03-29"
title: "Laxative Drug Products for Over-the-Counter Human Use; Psyllium Ingredients in Granular Dosage Forms"
summary: "FDA final rule concluding that granular dosage forms containing psyllium ingredients presented an unnecessary esophageal-obstruction/choking risk and were not generally recognized as safe and effective as OTC laxatives."
status: "draft"
quality: "usable"
aliases:
  - "Laxative Drug Products for Over-the-Counter Human Use; Psyllium Ingredients in Granular Dosage Forms"
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
  title: "Laxative Drug Products for Over-the-Counter Human Use; Psyllium Ingredients in Granular Dosage Forms"
  authors: "U.S. Food and Drug Administration"
  year: 2007
  journal: "Federal Register"
  url: "https://www.federalregister.gov/documents/2007/03/29/E7-5740/laxative-drug-products-for-over-the-counter-human-use-psyllium-ingredients-in-granular-dosage-forms"
  citation: "U.S. Food and Drug Administration. (2007). Laxative Drug Products for Over-the-Counter Human Use; Psyllium Ingredients in Granular Dosage Forms. Federal Register. https://www.federalregister.gov/documents/2007/03/29/E7-5740/laxative-drug-products-for-over-the-counter-human-use-psyllium-ingredients-in-granular-dosage-forms"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    url: "https://www.federalregister.gov/documents/2007/03/29/E7-5740/laxative-drug-products-for-over-the-counter-human-use-psyllium-ingredients-in-granular-dosage-forms"
  canonicalUrl: "https://www.federalregister.gov/documents/2007/03/29/E7-5740/laxative-drug-products-for-over-the-counter-human-use-psyllium-ingredients-in-granular-dosage-forms"
researchEvidence:
  designKind: "guideline"
  designLabel: "guideline"
  populationLabel: "OTC psyllium users, especially users of granular dosage forms"
  durationLabel: "Final rule/postmarketing review context; no trial follow-up."
  aggregateRole: "primary"
  cohortKey: "cohort:federalregister-psyllium-granular-dosage-forms-2007-03-29:source-population"
  notes:
    - "Batch batch-005 extraction; claim use safety-only."
    - "Limitations: Regulatory interpretation of postmarketing and literature reports, not a controlled trial.; Focused on granular dosage forms and OTC laxative status."
    - "Population mismatch: Granular laxative dosage-form safety, not standard cholesterol powder protocol efficacy."
evidenceBucket: "Safety, adverse events, and drug-interaction boundaries"
whyItMatters: "FDA final-rule record for granular psyllium dosage-form choking and esophageal-obstruction risk, including postmarketing adverse-event context."
potentialMurphEndpoints:
  - "choking"
  - "esophageal obstruction"
  - "adverse events"
  - "hydration"
protocolTakeaway: "Avoid recommending dry granules or food-sprinkled/incompletely hydrated forms; protocol design should favor fully dispersed powder or other safer formulations per label."
murphTakeaway: "Murph extraction should preserve this source as safety/context evidence and avoid promoting it into a direct LDL-C claim."
studyDesign: "guideline"
modality: "oral psyllium husk / ispaghula husk safety, tolerability, label, or adjacent context"
claimUse: "safety-only"
sourceFindings:

  -
    findingId: "finding:federalregister-psyllium-granular-dosage-forms-2007-03-29-fr-granular-nongrase"
    sourceKey: "source_artifact:federalregister-psyllium-granular-dosage-forms-2007-03-29"
    extractedFromArtifactId: "art_federalregister_psyllium_granular_dosage_forms_2007_03_29"
    findingKind: "safety"
    population: "OTC psyllium users of granular dosage forms."
    exposure: "Granular psyllium products swallowed dry, dispersed, chewed, taken with washdown liquid, or sprinkled on food."
    outcome: "Regulatory conclusion on esophageal obstruction/choking risk."
    summary: "FDA concluded granular dosage forms containing psyllium ingredients are not generally recognized as safe and effective OTC laxatives because warnings and directions were inadequate for the esophageal obstruction/choking risk."
    evidenceUse:
      - "safety"
      - "context"
  -
    findingId: "finding:federalregister-psyllium-granular-dosage-forms-2007-03-29-fr-dose-form-boundary"
    sourceKey: "source_artifact:federalregister-psyllium-granular-dosage-forms-2007-03-29"
    extractedFromArtifactId: "art_federalregister_psyllium_granular_dosage_forms_2007_03_29"
    findingKind: "safety"
    population: "Consumers choosing psyllium formats."
    exposure: "Granular versus nongranular dosage forms."
    outcome: "Dosage-form safety boundary."
    summary: "The final rule distinguishes granular psyllium from nongranular dosage forms such as powders, tablets, and wafers, making dosage form a safety-relevant protocol variable."
    evidenceUse:
      - "safety"
      - "context"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
interventionOrExposure: "Granular dosage forms containing psyllium ingredients"
comparatorOrControl: "Not applicable or not extracted for this safety/context source."
durationOrFollowUp: "Final rule/postmarketing review context; no trial follow-up."
endpoints:
  - "choking"
  - "esophageal obstruction"
  - "adverse events"
  - "hydration"
adverseEventsOrSafetyNotes:
  - "FDA concluded granular dosage forms containing psyllium ingredients are not generally recognized as safe and effective OTC laxatives because warnings and directions were inadequate for the esophageal obstruction/choking risk."
  - "The final rule distinguishes granular psyllium from nongranular dosage forms such as powders, tablets, and wafers, making dosage form a safety-relevant protocol variable."
limitations:
  - "Regulatory interpretation of postmarketing and literature reports, not a controlled trial."
  - "Focused on granular dosage forms and OTC laxative status."
populationMismatch: "Granular laxative dosage-form safety, not standard cholesterol powder protocol efficacy."
directnessToProtocol: "general_guideline"
---
This source is included for **Safety, adverse events, and drug-interaction boundaries**.

**Findings:**

- `finding:federalregister-psyllium-granular-dosage-forms-2007-03-29-fr-granular-nongrase` — FDA concluded granular dosage forms containing psyllium ingredients are not generally recognized as safe and effective OTC laxatives because warnings and directions were inadequate for the esophageal obstruction/choking risk.
- `finding:federalregister-psyllium-granular-dosage-forms-2007-03-29-fr-dose-form-boundary` — The final rule distinguishes granular psyllium from nongranular dosage forms such as powders, tablets, and wafers, making dosage form a safety-relevant protocol variable.

**Why it matters:** FDA final-rule record for granular psyllium dosage-form choking and esophageal-obstruction risk, including postmarketing adverse-event context.

**Potential experiment signals:**

- choking
- esophageal obstruction
- adverse events
- hydration

**Protocol takeaway:** Avoid recommending dry granules or food-sprinkled/incompletely hydrated forms; protocol design should favor fully dispersed powder or other safer formulations per label.

**Limitations and population mismatch:** Regulatory interpretation of postmarketing and literature reports, not a controlled trial.; Focused on granular dosage forms and OTC laxative status. Population mismatch: Granular laxative dosage-form safety, not standard cholesterol powder protocol efficacy.

**Claim use:** `safety-only`.
