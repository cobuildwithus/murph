---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:bryan-johnson-sperm-health-protocol-2025-06-10
slug: sources/dry-sauna/bryan-johnson-sperm-health-protocol-2025-06-10
title: My Sperm Health Protocol
summary: The Blueprint sperm-health protocol reports repeated semen testing and recommends avoiding testicular heat, including no saunas or sauna only with a testicular ice pack; it reports average total motile count and other semen markers but does not establish causality.
status: draft
quality: usable
aliases:
- My Sperm Health Protocol
categories:
- dry-sauna
- fertility-safety
- semen-analysis
- groin-cooling
relations:
- type: related_protocol
  target: protocol_variant:dry-sauna/bryan-johnson-blueprint
- type: parent_family
  target: experiment_family:dry-sauna
source:
  kind: web_page
  title: My Sperm Health Protocol
  authors: Bryan Johnson
  year: 2025
  journal: Blueprint Bryan Johnson
  url: https://blueprint.bryanjohnson.com/blogs/news/my-sperm-health-protocol
  citation: Bryan Johnson. My Sperm Health Protocol. Blueprint Bryan Johnson. 2025. https://blueprint.bryanjohnson.com/blogs/news/my-sperm-health-protocol
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://blueprint.bryanjohnson.com/blogs/news/my-sperm-health-protocol
  canonicalUrl: https://blueprint.bryanjohnson.com/blogs/news/my-sperm-health-protocol
researchEvidence:
  designKind: other
  designLabel: other
  populationLabel: Bryan Johnson self-tracking and Blueprint audience
  durationLabel: 3 months of repeated semen/lab tracking described on the page
  aggregateRole: context
  cohortKey: dry-sauna-fertility-semen-cooling-context
  participantCount: 1
  participantCountKind: reported
  notes:
  - 'Limitations: Commercial/owner protocol page; self-tracking; no independent trial; raw lab time series not extracted here.'
  - 'Population/protocol mismatch: Direct external protocol guidance, but not a peer-reviewed test of sauna plus groin icing.'
evidenceBucket: Fertility, semen, and groin-cooling safety/context
whyItMatters: 'Defines the external protocol boundary: avoid testicular heat or use a testicular ice pack during sauna.'
potentialMurphEndpoints:
- cooling-tactics
- fertility
- safety-exclusions
- routine-provenance
protocolTakeaway: Use as protocol-provenance and safety guidance, not as proof that the sauna routine improves sperm health.
murphTakeaway: Treat semen analysis, motility, morphology, and total motile count as possible monitoring endpoints when fertility is a user goal.
studyDesign: other
modality: external protocol guidance
claimUse: safety-only
directnessToBryanJohnsonSauna: direct_protocol
claimUseBoundary: Use as protocol-provenance and safety guidance, not as proof that the sauna routine improves sperm health.
sourceFindings:
- findingId: finding:bryan-johnson-sperm-health-protocol-2025-06-10-batch007-fertility-safety
  sourceKey: source_artifact:bryan-johnson-sperm-health-protocol-2025-06-10
  extractedFromArtifactId: art-bryan-johnson-sperm-health-protocol-2025-06-10-html
  findingKind: context
  population: Bryan Johnson self-tracking and Blueprint audience
  exposure: Sperm-health protocol emphasizing avoidance of testicular heat; no saunas unless using a testicular ice pack
  outcome: Semen quality metrics and protocol heat-avoidance guidance
  summary: The Blueprint sperm-health protocol reports repeated semen testing and recommends avoiding testicular heat, including no saunas or sauna only with a testicular ice pack; it reports average total motile count and other semen markers but does not establish causality.
  evidenceUse:
  - context
  - safety
  - measurement
murphV1Priority: High
pdfRightsStatus: unknown
---

This source is included for **Fertility, semen, and groin-cooling safety/context**.

**Findings:** The Blueprint sperm-health protocol reports repeated semen testing and recommends avoiding testicular heat, including no saunas or sauna only with a testicular ice pack; it reports average total motile count and other semen markers but does not establish causality.

**Why it matters:** Defines the external protocol boundary: avoid testicular heat or use a testicular ice pack during sauna.

**Potential experiment signals:** cooling-tactics, fertility, safety-exclusions, routine-provenance.

**Protocol takeaway:** Use as protocol-provenance and safety guidance, not as proof that the sauna routine improves sperm health.

**Claim use:** `safety-only`.

**Directness and limitations:** Direct external protocol guidance, but not a peer-reviewed test of sauna plus groin icing. Commercial/owner protocol page; self-tracking; no independent trial; raw lab time series not extracted here.
