---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.2903-j.efsa.2010.1735"
slug: "sources/psyllium-husk/doi-10.2903-j.efsa.2010.1735"
title: "Scientific Opinion on the substantiation of health claims related to dietary fibre pursuant to Article 13(1) of Regulation (EC) No 1924/2006"
summary: "EFSA dietary-fibre health-claim opinion kept as a regulatory-context source with a flagged DOI/title mismatch."
status: "draft"
quality: "usable"
aliases:
  - "Scientific Opinion on the substantiation of health claims related to dietary fibre and maintenance of normal blood cholesterol concentrations (ID 747, 750, 811)"
  - "doi-10.2903-j.efsa.2010.1735"
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
  title: "Scientific Opinion on the substantiation of health claims related to dietary fibre pursuant to Article 13(1) of Regulation (EC) No 1924/2006"
  authors: "EFSA Panel on Dietetic Products, Nutrition and Allergies (NDA)"
  year: 2010
  journal: "EFSA Journal"
  citation: "EFSA Panel on Dietetic Products, Nutrition and Allergies (NDA). Scientific Opinion on the substantiation of health claims related to dietary fibre pursuant to Article 13(1) of Regulation (EC) No 1924/2006. EFSA Journal. 2010. doi:10.2903/j.efsa.2010.1735."
  doi: "10.2903/j.efsa.2010.1735"
  url: "https://doi.org/10.2903/j.efsa.2010.1735"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.2903/j.efsa.2010.1735"
    url: "https://doi.org/10.2903/j.efsa.2010.1735"
  canonicalUrl: "https://doi.org/10.2903/j.efsa.2010.1735"
  identityAliases:
    - "Scientific Opinion on the substantiation of health claims related to dietary fibre and maintenance of normal blood cholesterol concentrations (ID 747, 750, 811)"
researchEvidence:
  designKind: "guideline"
  designLabel: "EFSA scientific opinion / regulatory claim assessment"
  populationLabel: "Regulatory assessment of dietary-fibre health-claim submissions"
  durationLabel: "Not applicable"
  aggregateRole: "context"
  cohortKey: "doi-10-2903-j-efsa-2010-1735"
evidenceBucket: "Mechanism: viscosity, bile-acid, sterol, and fecal-excretion context"
whyItMatters: "Prevents accidental use of an apparently mismatched regulatory DOI as if it were cholesterol-specific psyllium evidence."
potentialMurphEndpoints:
  - "regulatory claim boundary"
  - "source identity"
  - "cholesterol claim wording"
protocolTakeaway: "Do not use this DOI as direct cholesterol evidence unless the EFSA source identity is corrected or the cholesterol-specific opinion is separately added."
murphTakeaway: "This is a boundary and data-integrity source, not protocol-supporting evidence."
studyDesign: "EFSA scientific opinion / regulatory claim assessment"
modality: "Regulatory health-claim assessment"
claimUse: "context-only"
sourceFindings:

  -
    findingId: "finding:doi-10.2903-j.efsa.2010.1735-identity-boundary"
    sourceKey: "source_artifact:doi-10.2903-j.efsa.2010.1735"
    extractedFromArtifactId: "art_doi_10_2903_j_efsa_2010_1735_source"
    findingKind: "context"
    population: "Source ledger and EFSA regulatory context"
    exposure: "DOI 10.2903/j.efsa.2010.1735"
    outcome: "Source identity for dietary-fibre cholesterol claims"
    summary: "The requested DOI was treated as a broader EFSA dietary-fibre opinion; the cholesterol-specific title supplied in the batch is flagged as a possible identity mismatch and should not support protocol claims until resolved."
    evidenceUse:
      - "context"
murphV1Priority: "Low"
pdfRightsStatus: "open_access"
---
This source is included for **Mechanism: viscosity, bile-acid, sterol, and fecal-excretion context**.

## Quick read

- **Source type:** EFSA scientific opinion / regulatory claim assessment (2010).
- **People studied or addressed:** Regulatory assessment of dietary-fibre health-claim submissions.
- **Intervention or exposure:** Dietary fibre claims assessed by EFSA.
- **Comparator or control:** Not applicable.
- **Duration or follow-up:** Not applicable.
- **Endpoints:** Health-claim substantiation boundaries; identity and outcome wording.
- **Directness:** same_mechanism.
- **Claim use:** `context-only`.

## Findings

- The requested DOI was treated as a broader EFSA dietary-fibre opinion; the cholesterol-specific title supplied in the batch is flagged as a possible identity mismatch and should not support protocol claims until resolved.

## Why it matters

Prevents accidental use of an apparently mismatched regulatory DOI as if it were cholesterol-specific psyllium evidence.

## Potential experiment signals

- regulatory claim boundary
- source identity
- cholesterol claim wording

## Protocol takeaway

Do not use this DOI as direct cholesterol evidence unless the EFSA source identity is corrected or the cholesterol-specific opinion is separately added.

## Safety and adverse events

No psyllium-specific safety extraction was performed from this regulatory record.

## Limitations and population fit

Ledger title/DOI mismatch flagged; use only as an identity-boundary or regulatory-context source in this batch.

**Population mismatch:** General dietary-fibre claim context, not a verified psyllium-specific cholesterol source for this protocol.

## Artifact and rights notes

- **Candidate artifact id:** `art_doi_10_2903_j_efsa_2010_1735_source`
- **PDF rights status:** `open_access`
- Copyrighted PDFs should not be stored in Git; use metadata/link-only candidates unless redistribution rights are confirmed.
