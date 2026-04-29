---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.2903-j.efsa.2010.1885"
slug: "sources/psyllium-husk/doi-10.2903-j.efsa.2010.1885"
title: "Scientific Opinion on the substantiation of a health claim related to oat beta-glucan and lowering blood cholesterol and reduced risk of (coronary) heart disease pursuant to Article 14 of Regulation (EC) No 1924/2006"
summary: "EFSA regulatory scientific opinion for oat beta-glucan cholesterol claims; adjacent soluble-fiber comparator, not psyllium evidence."
status: "draft"
quality: "usable"
aliases:
  - "doi-10.2903-j.efsa.2010.1885"
  - "DOI 10.2903/j.efsa.2010.1885"
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
  title: "Scientific Opinion on the substantiation of a health claim related to oat beta-glucan and lowering blood cholesterol and reduced risk of (coronary) heart disease pursuant to Article 14 of Regulation (EC) No 1924/2006"
  authors: "EFSA Panel on Dietetic Products, Nutrition and Allergies (NDA)"
  year: 2010
  journal: "EFSA Journal"
  citation: "EFSA Panel on Dietetic Products, Nutrition and Allergies (NDA). Scientific Opinion on the substantiation of a health claim related to oat beta-glucan and lowering blood cholesterol and reduced risk of (coronary) heart disease pursuant to Article 14 of Regulation (EC) No 1924/2006. EFSA Journal. 2010. doi:10.2903/j.efsa.2010.1885."
  doi: "10.2903/j.efsa.2010.1885"
  url: "https://efsa.onlinelibrary.wiley.com/doi/abs/10.2903/j.efsa.2010.1885"
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.2903/j.efsa.2010.1885"
    titleHash: "0f5413dd23eb99e9eba6bb8286ddd27e2c1de956d0161ba9cc8c430f2b3c7a25"
    url: "https://efsa.onlinelibrary.wiley.com/doi/abs/10.2903/j.efsa.2010.1885"
  canonicalUrl: "https://efsa.onlinelibrary.wiley.com/doi/abs/10.2903/j.efsa.2010.1885"
researchEvidence:
  designKind: "guideline"
  designLabel: "guideline"
  populationLabel: "Adults who want to lower blood cholesterol concentrations."
  durationLabel: "Regulatory scientific opinion; no single protocol duration."
  aggregateRole: "context"
  cohortKey: "doi-10.2903-j.efsa.2010.1885"
  notes:
    - "Participant count is not applicable or not reported for this regulatory/guideline/context source."
evidenceBucket: "Regulatory, guideline, and external health-claim context"
whyItMatters: "Helps compare how another viscous soluble fiber is handled in regulatory cholesterol claims without substituting for psyllium evidence."
potentialMurphEndpoints:
  - "LDL-C"
  - "total cholesterol"
  - "fiber type"
  - "claim dose"
protocolTakeaway: "Use only as adjacent regulatory context; never cite as direct psyllium efficacy."
murphTakeaway: "Oat beta-glucan context can inform soluble-fiber landscape, not psyllium-specific protocol claims."
studyDesign: "guideline"
modality: "adjacent soluble fiber cholesterol context"
claimUse: "context-only"
sourceFindings:

  -
    findingId: "finding:doi-10.2903-j.efsa.2010.1885-oat-beta-glucan-adjacent-claim"
    sourceKey: "source_artifact:doi-10.2903-j.efsa.2010.1885"
    findingKind: "context"
    population: "Adults seeking lower blood cholesterol."
    exposure: "Oat beta-glucan."
    outcome: "LDL-C and blood cholesterol claim substantiation."
    summary: "EFSA's opinion supports an oat beta-glucan cholesterol claim and a claim-bearing intake context around 3 g/day, but this is an adjacent beta-glucan source and not psyllium evidence."
    evidenceUse:
      - "adjacent_variant"
      - "context"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
extractionNotes:
  batchId: "batch-006"
  evidenceBucket: "Regulatory, guideline, and external health-claim context"
  participantCountNote: "No source-level participant count was applicable or extractable for this context batch unless an included-study count is explicitly listed."
  claimUseBoundary: "context-only; do not use as primary efficacy evidence for the protocol."
populationMismatch: "Adjacent soluble-fiber ingredient with different physicochemical properties."
limitations: "Oat beta-glucan, not psyllium husk; regulatory claim opinion rather than protocol evidence."
safetyNotes: "No psyllium-specific safety information."
---
This source is included for **Regulatory, guideline, and external health-claim context**.

**Findings:** EFSA concluded a cause-and-effect relationship between oat beta-glucan and lowering blood LDL-cholesterol and considered at least 3 g/day oat beta-glucan necessary for claim-bearing foods; this is an adjacent fiber variant.

**Why it matters:** Helps compare how another viscous soluble fiber is handled in regulatory cholesterol claims without substituting for psyllium evidence.

**Potential experiment signals:** LDL-C, total cholesterol, fiber type, claim dose

**Protocol takeaway:** Use only as adjacent regulatory context; never cite as direct psyllium efficacy.

**Claim use:** `context-only`.

## Extracted source fields

- **Participant count:** Not applicable or not reported for this context source.
- **Participant count kind:** Not applicable/not extracted.
- **Population:** Adults who want to lower blood cholesterol concentrations.
- **Intervention / exposure:** Oat beta-glucan at claim-bearing dietary amounts.
- **Comparator / control:** Control foods or diets in beta-glucan RCT evidence considered by EFSA.
- **Duration / follow-up:** Regulatory scientific opinion; no single protocol duration.
- **Endpoints:** LDL-C, blood cholesterol, CHD risk claim
- **Adverse events / safety notes:** No psyllium-specific safety information.
- **Limitations:** Oat beta-glucan, not psyllium husk; regulatory claim opinion rather than protocol evidence.
- **Population mismatch:** Adjacent soluble-fiber ingredient with different physicochemical properties.
- **Directness to Psyllium Husk For Cholesterol:** adjacent_variant
- **Artifact / rights notes:** No downloadable artifact candidate required for this batch; rights status open_access.

## Source-owned findings

- `finding:doi-10.2903-j.efsa.2010.1885-oat-beta-glucan-adjacent-claim` — EFSA's opinion supports an oat beta-glucan cholesterol claim and a claim-bearing intake context around 3 g/day, but this is an adjacent beta-glucan source and not psyllium evidence.
