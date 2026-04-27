---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.3109-03639049509070866"
slug: "sources/psyllium-husk/doi-10.3109-03639049509070866"
title: "Effect of a bulk forming laxative on the bioavailability of carbamazepine in man"
summary: "Human pharmacokinetic study of a bulk-forming laxative consisting of 3.5 g ispaghula husk with carbamazepine; included as a primary medication-bioavailability source for timing caution."
status: "draft"
quality: "usable"
aliases:
  - "Effect of a bulk forming laxative on the bioavailability of carbamazepine in man"
  - "DOI 10.3109/03639049509070866"
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
  kind: "journal_article"
  title: "Effect of a bulk forming laxative on the bioavailability of carbamazepine in man"
  authors: "Etman MA"
  year: 1995
  journal: "Drug Development and Industrial Pharmacy"
  doi: "10.3109/03639049509070866"
  url: "https://doi.org/10.3109/03639049509070866"
  citation: "Etman MA. (1995). Effect of a bulk forming laxative on the bioavailability of carbamazepine in man. Drug Development and Industrial Pharmacy. doi:10.3109/03639049509070866. https://doi.org/10.3109/03639049509070866"
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.3109/03639049509070866"
    url: "https://doi.org/10.3109/03639049509070866"
  canonicalUrl: "https://doi.org/10.3109/03639049509070866"
researchEvidence:
  designKind: "acute_mechanistic"
  designLabel: "mechanistic"
  populationLabel: "Human volunteers taking carbamazepine with a bulk-forming laxative"
  durationLabel: "Human pharmacokinetic study; exact duration/sample size not extracted."
  aggregateRole: "primary"
  cohortKey: "cohort:doi-10.3109-03639049509070866:source-population"
  notes:
    - "Batch batch-005 extraction; claim use safety-only."
    - "Limitations: Paywalled DOI source with limited accessible details.; No LDL-C endpoint."
    - "Population mismatch: Carbamazepine pharmacokinetics, not cholesterol protocol efficacy."
evidenceBucket: "Safety, adverse events, and drug-interaction boundaries"
whyItMatters: "Primary pharmacokinetic source behind warnings that bulk fibers can reduce drug absorption."
potentialMurphEndpoints:
  - "medication absorption"
  - "drug interactions"
protocolTakeaway: "Users on carbamazepine or similar narrow-therapeutic-index drugs need clinician/pharmacist guidance before psyllium timing changes."
murphTakeaway: "Murph extraction should preserve this source as safety/context evidence and avoid promoting it into a direct LDL-C claim."
studyDesign: "mechanistic"
modality: "oral psyllium husk / ispaghula husk safety, tolerability, label, or adjacent context"
claimUse: "safety-only"
sourceFindings:
  -
    findingId: "finding:doi-10.3109-03639049509070866-ispaghula-carbamazepine-bioavailability"
    sourceKey: "source_artifact:doi-10.3109-03639049509070866"
    extractedFromArtifactId: "art_doi_10.3109_03639049509070866"
    findingKind: "safety"
    population: "Human volunteers or participants taking carbamazepine."
    exposure: "Bulk-forming laxative containing 3.5 g ispaghula husk coadministered with carbamazepine."
    outcome: "Carbamazepine bioavailability."
    summary: "The study is a primary pharmacokinetic source on carbamazepine bioavailability with an ispaghula-containing bulk-forming laxative; exact effect size was not extracted here."
    evidenceUse:
      - "safety"
      - "context"
murphV1Priority: "Medium"
pdfRightsStatus: "paywalled"
interventionOrExposure: "Bulk-forming laxative coadministered with carbamazepine"
comparatorOrControl: "Not applicable or not extracted for this safety/context source."
durationOrFollowUp: "Human pharmacokinetic study; exact duration/sample size not extracted."
endpoints:
  - "medication absorption"
  - "drug interactions"
adverseEventsOrSafetyNotes:
  - "The study is a primary pharmacokinetic source on carbamazepine bioavailability with an ispaghula-containing bulk-forming laxative; exact effect size was not extracted here."
limitations:
  - "Paywalled DOI source with limited accessible details."
  - "No LDL-C endpoint."
populationMismatch: "Carbamazepine pharmacokinetics, not cholesterol protocol efficacy."
directnessToProtocol: "clinical_supervised"
---
This source is included for **Safety, adverse events, and drug-interaction boundaries**.

**Findings:**

- `finding:doi-10.3109-03639049509070866-ispaghula-carbamazepine-bioavailability` — The study is a primary pharmacokinetic source on carbamazepine bioavailability with an ispaghula-containing bulk-forming laxative; exact effect size was not extracted here.

**Why it matters:** Primary pharmacokinetic source behind warnings that bulk fibers can reduce drug absorption.

**Potential experiment signals:**

- medication absorption
- drug interactions

**Protocol takeaway:** Users on carbamazepine or similar narrow-therapeutic-index drugs need clinician/pharmacist guidance before psyllium timing changes.

**Limitations and population mismatch:** Paywalled DOI source with limited accessible details.; No LDL-C endpoint. Population mismatch: Carbamazepine pharmacokinetics, not cholesterol protocol efficacy.

**Claim use:** `safety-only`.
