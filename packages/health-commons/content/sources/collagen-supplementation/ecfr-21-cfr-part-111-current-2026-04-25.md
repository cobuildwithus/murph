---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:ecfr-21-cfr-part-111-current-2026-04-25
slug: sources/collagen-supplementation/ecfr-21-cfr-part-111-current-2026-04-25
title: 21 CFR Part 111 — Current Good Manufacturing Practice in Manufacturing, Packaging, Labeling, or Holding Operations for Dietary Supplements
summary: 21 CFR Part 111 defines U.S. cGMP requirements for dietary supplement manufacturing, packaging, labeling, and holding operations.
status: draft
quality: usable
aliases:
- 21 CFR Part 111 — Current Good Manufacturing Practice in Manufacturing, Packaging, Labeling, or Holding Operations for Dietary Supplements
categories:
- collagen-supplementation
- safety-quality-contaminants
- safety_boundary
- safety-only
relations:
-
  type: related_protocol
  target: protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides
-
  type: parent_family
  target: experiment_family:collagen-supplementation
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    url: https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-111
  canonicalUrl: https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-111
  identityAliases:
  - 21 CFR Part 111 — Current Good Manufacturing Practice in Manufacturing, Packaging, Labeling, or Holding Operations for Dietary Supplements
source:
  kind: guideline
  title: 21 CFR Part 111 — Current Good Manufacturing Practice in Manufacturing, Packaging, Labeling, or Holding Operations for Dietary Supplements
  authors: Electronic Code of Federal Regulations; U.S. Food and Drug Administration; Office of the Federal Register
  citation: Electronic Code of Federal Regulations. 21 CFR Part 111—Current Good Manufacturing Practice in Manufacturing, Packaging, Labeling, or Holding Operations for Dietary Supplements. Current as accessed April 25, 2026.
  year: 2026
  journal: eCFR
  url: https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-111
researchEvidence:
  designKind: other
  designLabel: Federal current good manufacturing practice requirements for dietary supplements
  populationLabel: Dietary supplement manufacturers, packagers, labelers, holders, importers, and related operations subject to 21 CFR Part 111
  durationLabel: Current regulation; no study duration
  cohortKey: batch-009:ecfr-21-cfr-part-111-current-2026-04-25
  aggregateRole: primary
evidenceBucket: safety-quality-contaminants
whyItMatters: Authoritative product-quality context for collagen supplements sold as dietary supplements.
potentialMurphEndpoints:
- regulatory:cGMP
- safety:contamination-control
- safety:lot-traceability
- safety:labeling
protocolTakeaway: Use source_artifact:ecfr-21-cfr-part-111-current-2026-04-25 as regulatory product-quality context only.
murphTakeaway: 'Use for checklist-style product-quality guardrails: identity, contaminant specifications, batch records, and lot traceability.'
studyDesign: Federal current good manufacturing practice requirements for dietary supplements
modality: dietary supplement cGMP regulation
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: safety-quality-contaminants
  directness: safety_boundary
  claimUse: safety-only
  priority: high
  batchId: batch-009
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **safety-quality-contaminants**.

**Findings:** Population/exposure: Dietary supplement manufacturers, packagers, labelers, holders, importers, and related operations subject to 21 CFR Part 111 Intervention or exposure: Regulatory requirements for dietary supplement manufacturing, packaging, labeling, holding, specifications, quality control, and records. Comparator/control: Not applicable. Duration/follow-up: Current regulation; no study duration Endpoints: identity specifications, purity specifications, strength specifications, composition specifications, contamination limits, component quarantine, lot traceability, packaging/label controls. Direction/effect: Part 111 requires specifications and controls intended to ensure dietary supplement identity, purity, strength, composition, and contamination limits. Safety notes: Not an adverse-event source; provides product-quality and regulatory context. Limitations: Regulation does not prove any specific collagen product is compliant.; Does not evaluate clinical safety or efficacy.; Current as an access-date-specific source.. Population mismatch: Regulatory operations rather than human participants.

**Why it matters:** Authoritative product-quality context for collagen supplements sold as dietary supplements.

**Potential experiment signals:** regulatory:cGMP, safety:contamination-control, safety:lot-traceability, safety:labeling.

**Protocol takeaway:** Use source_artifact:ecfr-21-cfr-part-111-current-2026-04-25 as regulatory product-quality context only.

**Claim use:** `safety-only`. Directness: `safety_boundary`. Rights status guess: `unknown`.
