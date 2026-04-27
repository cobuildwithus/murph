---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:mhlw-beni-koji-adverse-events-2025-03-19"
slug: "sources/red-yeast-rice/mhlw-beni-koji-adverse-events-2025-03-19"
title: "Information on Adverse Events associated with Beni-koji (Red Yeast Rice) related Products"
summary: "Japanese MHLW information page on Beni-koji adverse events, recall/disposal orders, company inspections, and cause-investigation updates."
status: "draft"
quality: "usable"
aliases:
  - "MHLW Beni-koji adverse events information page"
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
  kind: "web_page"
  title: "Information on Adverse Events associated with Beni-koji (Red Yeast Rice) related Products"
  authors: "Ministry of Health, Labour and Welfare, Japan"
  year: 2025
  journal: "MHLW"
  citation: "Ministry of Health, Labour and Welfare, Japan. Information on Adverse Events associated with Beni-koji (Red Yeast Rice) related Products. 2025."
  url: "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/shokuhin/daietto/index_00005.html"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "07a689a24b2f31b7cb86838a99053d29f260897c4e46dfc93f692ecaaccc07d8"
    url: "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/shokuhin/daietto/index_00005.html"
  canonicalUrl: "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/shokuhin/daietto/index_00005.html"
researchEvidence:
  designKind: "guideline"
  designLabel: "Government adverse-event information page"
  populationLabel: "Consumers of specified Kobayashi Beni-koji products and stakeholders in Japan."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "mhlw-beni-koji-adverse-events-2025-03-19"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Provides government-level safety context and later cause-investigation details for the Kobayashi Beni-koji event."
potentialMurphEndpoints:
  - "kidney symptoms"
  - "product recall status"
  - "batch/source supplier"
  - "eGFR/urinalysis if clinically indicated"
protocolTakeaway: "Use as adjacent safety evidence and recall guardrail; do not extrapolate incidence to unrelated products."
murphTakeaway: "A Murph red yeast rice protocol should treat kidney symptoms and recalled Beni-koji products as stop conditions."
studyDesign: "Government adverse-event information page"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:
  -
    findingKind: "safety"
    population: "Consumers of specified Beni-koji products in Japan"
    exposure: "Recalled Beni-koji red yeast rice products"
    outcome: "Government stop-use and investigation updates"
    summary: "MHLW instructed consumers to stop consuming three specified Beni-koji products and described investigation updates linking the event to blue-mold contamination and puberulic acid renal-toxicity findings; the source is adjacent safety context, not efficacy evidence."
    evidenceUse:
      - "safety"
      - "adjacent_variant"
      - "context"
    findingId: "finding:mhlw-beni-koji-adverse-events-2025-03-19-mhlw-adverse-events-context"
    sourceKey: "source_artifact:mhlw-beni-koji-adverse-events-2025-03-19"
    extractedFromArtifactId: "art_mhlw_beni_koji_adverse_events_2025_03_19_html"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
artifacts:
  -
    artifactId: "art_mhlw_beni_koji_adverse_events_2025_03_19_html"
    sourceKey: "source_artifact:mhlw-beni-koji-adverse-events-2025-03-19"
    kind: "html"
    storage: "external"
    sourceUrl: "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/shokuhin/daietto/index_00005.html"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Consumers of specified Kobayashi Beni-koji products and stakeholders in Japan."
  interventionOrExposure: "Beni-koji red yeast rice products and related raw materials."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "recall/disposal order"
    - "kidney adverse events"
    - "puberulic acid / blue-mold contamination context"
  effectEstimatesOrDirection: "MHLW instructed discontinuation of three products subject to recall/disposal orders and reported investigation updates implicating Penicillium adametzioides contamination and puberulic acid in renal dysfunction testing."
  adverseEventsOrSafetyNotes: "Kidney adverse events were the focus; MHLW advised stopping use and consulting medical/public-health authorities."
  limitations: "Government information page with evolving investigation status; product-specific Japanese event, not a generalized RYR efficacy study."
  populationMismatch: "Japanese Beni-koji products and outbreak investigation; adjacent safety context for a red yeast rice cholesterol protocol."
  directnessToProtocol: "adjacent_variant"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** Japanese MHLW information page on Beni-koji adverse events, recall/disposal orders, company inspections, and cause-investigation updates.

**Why it matters:** Provides government-level safety context and later cause-investigation details for the Kobayashi Beni-koji event.

**Potential experiment signals:** kidney symptoms, product recall status, batch/source supplier, eGFR/urinalysis if clinically indicated.

**Protocol takeaway:** Use as adjacent safety evidence and recall guardrail; do not extrapolate incidence to unrelated products.

**Claim use:** `safety-only`.
