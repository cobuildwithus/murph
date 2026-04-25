---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:ncbi-livertox-omega-3-fatty-acids-2017-04-08
slug: sources/omega-3-supplementation/ncbi-livertox-omega-3-fatty-acids-2017-04-08
title: Omega-3 Fatty Acids
summary: LiverTox states omega-3 fatty acids are generally safe, well tolerated, and unlikely to cause clinically apparent liver injury; high-dose prescription contexts may call for hepatic monitoring.
status: draft
quality: usable
aliases:
- 'LiverTox: Clinical and Research Information on Drug-Induced Liver Injury 2017'
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
  title: Omega-3 Fatty Acids
  authors: 'LiverTox: Clinical and Research Information on Drug-Induced Liver Injury'
  year: 2017
  journal: NCBI Bookshelf / LiverTox
  citation: 'LiverTox: Clinical and Research Information on Drug-Induced Liver Injury. Omega-3 Fatty Acids. NCBI Bookshelf / LiverTox. 2017.'
  url: https://www.ncbi.nlm.nih.gov/books/NBK548910/
researchEvidence:
  designKind: narrative_review
  designLabel: Authoritative hepatotoxicity reference
  populationLabel: Users of omega-3 supplements and prescription omega-3 products with hepatic safety considerations
  durationLabel: Not applicable; updated April 8, 2017
  aggregateRole: primary
  cohortKey: livertox-2017-omega3-fatty-acids
evidenceBucket: safety_adverse_events
whyItMatters: Defines the liver-injury safety boundary and monitoring considerations for people with hepatic impairment or existing liver disease.
potentialMurphEndpoints:
- ALT
- AST
- GGT
- hepatic impairment
- GI symptoms
- bleeding risk with anticoagulants
protocolTakeaway: 'Use as liver-safety boundary: omega-3 fatty acids are unlikely to cause clinically apparent liver injury, but clinical products advise monitoring in hepatic impairment.'
murphTakeaway: Routine users do not need liver-injury fear language, but those with liver disease or prescription high-dose use should be under clinician monitoring.
studyDesign: Narrative hepatotoxicity review
modality: Omega-3 supplements and prescription omega-3 products
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **safety_adverse_events**.

**Findings:** LiverTox reports that omega-3 fatty acids have not been convincingly linked to serum enzyme elevations or clinically apparent liver injury. Minor ALT elevations at high doses were reported at rates similar to placebo and were mild/transient; NAFLD trials did not show hepatic worsening.

**Why it matters:** Defines the liver-injury safety boundary and monitoring considerations for people with hepatic impairment or existing liver disease.

**Potential experiment signals:** ALT, AST, GGT, hepatic impairment, GI symptoms, bleeding risk with anticoagulants.

**Protocol takeaway:** Use as liver-safety boundary: omega-3 fatty acids are unlikely to cause clinically apparent liver injury, but clinical products advise monitoring in hepatic impairment.

**Claim use:** `safety-only`.

**Directness:** `safety_boundary` for `protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation`.

**Limitations and population mismatch:** Reference review; product-specific prescription labels and individual liver disease status still matter.
