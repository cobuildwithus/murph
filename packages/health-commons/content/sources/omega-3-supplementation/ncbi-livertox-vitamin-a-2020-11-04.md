---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:ncbi-livertox-vitamin-a-2020-11-04
slug: sources/omega-3-supplementation/ncbi-livertox-vitamin-a-2020-11-04
title: Vitamin A
summary: Authoritative hepatotoxicity context for vitamin A exposure, relevant to cod liver oil products that contain retinol.
status: draft
quality: usable
aliases:
- Vitamin A
categories:
- omega-3-supplementation
relations:
-
  type: related_protocol
  target: protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation
-
  type: parent_family
  target: experiment_family:omega-3-supplementation
source:
  kind: web_page
  title: Vitamin A
  authors: National Institute of Diabetes and Digestive and Kidney Diseases
  year: 2020
  journal: LiverTox, NCBI Bookshelf
  citation: 'National Institute of Diabetes and Digestive and Kidney Diseases. Vitamin A. LiverTox: Clinical and Research Information on Drug-Induced Liver Injury. Updated 2020 Nov 4.'
  url: https://www.ncbi.nlm.nih.gov/books/NBK548165/
researchEvidence:
  designKind: other
  designLabel: other
  populationLabel: People exposed to vitamin A from supplements, liver, cod liver oil, or retinoids in LiverTox safety context.
  durationLabel: Reference last updated 2020-11-04.
  aggregateRole: primary
  cohortKey: ncbi-livertox-vitamin-a-2020-11-04
evidenceBucket: variant_boundaries_external_context
whyItMatters: Users choosing cod liver oil need retinol-dose awareness beyond EPA/DHA dosing.
potentialMurphEndpoints:
- vitamin A dose
- liver enzymes
- jaundice
- hepatotoxicity
protocolTakeaway: Users choosing cod liver oil need retinol-dose awareness beyond EPA/DHA dosing.
murphTakeaway: 'Users choosing cod liver oil need retinol-dose awareness beyond EPA/DHA dosing. Preserve the source boundary: This source should not be used to imply vitamin A risk from EPA/DHA-only products.'
studyDesign: other
modality: omega-3 variant boundary or external context
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---
This source is included for **variant_boundaries_external_context**.

**Findings:** LiverTox supports a safety boundary for retinol-containing cod liver oil, not for EPA/DHA-only supplements. [source_artifact:ncbi-livertox-vitamin-a-2020-11-04].

**Why it matters:** Users choosing cod liver oil need retinol-dose awareness beyond EPA/DHA dosing. [source_artifact:ncbi-livertox-vitamin-a-2020-11-04].

**Potential experiment signals:** vitamin A dose, liver enzymes, jaundice, hepatotoxicity

**Protocol takeaway:** Users choosing cod liver oil need retinol-dose awareness beyond EPA/DHA dosing. [source_artifact:ncbi-livertox-vitamin-a-2020-11-04].

**Claim use:** `context-only`.

**Extraction limitations:**
- Vitamin A safety reference, not omega-3 protocol evidence.
- Does not evaluate fish oil or algal oil products that lack retinol.
- Dose-risk depends on total vitamin A exposure.
