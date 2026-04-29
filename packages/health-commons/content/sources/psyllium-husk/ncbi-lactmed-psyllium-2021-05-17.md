---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:ncbi-lactmed-psyllium-2021-05-17"
slug: "sources/psyllium-husk/ncbi-lactmed-psyllium-2021-05-17"
title: "Psyllium - Drugs and Lactation Database (LactMed)"
summary: "LactMed entry stating that psyllium is not absorbed from the gastrointestinal tract, is not expected to enter breast milk, and is considered acceptable during breastfeeding, while noting limited direct data."
status: "draft"
quality: "usable"
aliases:
  - "Psyllium - Drugs and Lactation Database (LactMed)"
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
  kind: "web_page"
  title: "Psyllium - Drugs and Lactation Database (LactMed)"
  authors: "National Library of Medicine"
  year: 2021
  journal: "LactMed / NCBI Bookshelf"
  url: "https://www.ncbi.nlm.nih.gov/books/NBK501346/"
  citation: "National Library of Medicine. (2021). Psyllium - Drugs and Lactation Database (LactMed). LactMed / NCBI Bookshelf. https://www.ncbi.nlm.nih.gov/books/NBK501346/"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    url: "https://www.ncbi.nlm.nih.gov/books/NBK501346/"
  canonicalUrl: "https://www.ncbi.nlm.nih.gov/books/NBK501346/"
researchEvidence:
  designKind: "other"
  designLabel: "other"
  populationLabel: "Breastfeeding and lactation context"
  durationLabel: "Database record last revised 2021; cited postpartum exposure in days 2-4."
  aggregateRole: "primary"
  cohortKey: "cohort:ncbi-lactmed-psyllium-2021-05-17:source-population"
  notes:
    - "Batch batch-005 extraction; claim use safety-only."
    - "Limitations: Database summary, not a cholesterol trial.; Limited lactation-specific clinical data."
    - "Population mismatch: Breastfeeding/postpartum context rather than hypercholesterolemia trial population."
evidenceBucket: "Safety, adverse events, and drug-interaction boundaries"
whyItMatters: "Specific lactation boundary source; avoids inferring breastfeeding safety from adult lipid trials."
potentialMurphEndpoints:
  - "safety"
  - "pregnancy/lactation"
  - "population mismatch"
protocolTakeaway: "Breastfeeding users can cite this as context, while still checking with a clinician and following choking/medication-spacing warnings."
murphTakeaway: "Murph extraction should preserve this source as safety/context evidence and avoid promoting it into a direct LDL-C claim."
studyDesign: "other"
modality: "oral psyllium husk / ispaghula husk safety, tolerability, label, or adjacent context"
claimUse: "safety-only"
sourceFindings:

  -
    findingId: "finding:ncbi-lactmed-psyllium-2021-05-17-lactmed-absorption-milk"
    sourceKey: "source_artifact:ncbi-lactmed-psyllium-2021-05-17"
    extractedFromArtifactId: "art_ncbi_lactmed_psyllium_2021_05_17"
    findingKind: "safety"
    population: "Breastfeeding people and breastfed infants."
    exposure: "Maternal psyllium use during breastfeeding."
    outcome: "Milk transfer and infant safety expectation."
    summary: "LactMed states psyllium is not absorbed from the gastrointestinal tract, is not expected to enter milk, and is acceptable during breastfeeding."
    evidenceUse:
      - "safety"
      - "context"
  -
    findingId: "finding:ncbi-lactmed-psyllium-2021-05-17-lactmed-postpartum-laxative"
    sourceKey: "source_artifact:ncbi-lactmed-psyllium-2021-05-17"
    extractedFromArtifactId: "art_ncbi_lactmed_psyllium_2021_05_17"
    findingKind: "context"
    population: "Twenty postpartum mothers in a cited laxative exposure; 11 infants breastfed."
    exposure: "Laxative containing plantago/psyllium plus senna on postpartum days 2-4."
    outcome: "Infant stool adverse-event signal."
    summary: "LactMed reports no loose stools among 11 breastfed infants in a small postpartum exposure report, while noting the product also contained senna."
    evidenceUse:
      - "safety"
      - "context"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
interventionOrExposure: "Psyllium exposure during breastfeeding"
comparatorOrControl: "Not applicable or not extracted for this safety/context source."
durationOrFollowUp: "Database record last revised 2021; cited postpartum exposure in days 2-4."
endpoints:
  - "safety"
  - "pregnancy/lactation"
  - "population mismatch"
adverseEventsOrSafetyNotes:
  - "LactMed states psyllium is not absorbed from the gastrointestinal tract, is not expected to enter milk, and is acceptable during breastfeeding."
limitations:
  - "Database summary, not a cholesterol trial."
  - "Limited lactation-specific clinical data."
populationMismatch: "Breastfeeding/postpartum context rather than hypercholesterolemia trial population."
directnessToProtocol: "general_guideline"
---
This source is included for **Safety, adverse events, and drug-interaction boundaries**.

**Findings:**

- `finding:ncbi-lactmed-psyllium-2021-05-17-lactmed-absorption-milk` — LactMed states psyllium is not absorbed from the gastrointestinal tract, is not expected to enter milk, and is acceptable during breastfeeding.
- `finding:ncbi-lactmed-psyllium-2021-05-17-lactmed-postpartum-laxative` — LactMed reports no loose stools among 11 breastfed infants in a small postpartum exposure report, while noting the product also contained senna.

**Why it matters:** Specific lactation boundary source; avoids inferring breastfeeding safety from adult lipid trials.

**Potential experiment signals:**

- safety
- pregnancy/lactation
- population mismatch

**Protocol takeaway:** Breastfeeding users can cite this as context, while still checking with a clinician and following choking/medication-spacing warnings.

**Limitations and population mismatch:** Database summary, not a cholesterol trial.; Limited lactation-specific clinical data. Population mismatch: Breastfeeding/postpartum context rather than hypercholesterolemia trial population.

**Claim use:** `safety-only`.
