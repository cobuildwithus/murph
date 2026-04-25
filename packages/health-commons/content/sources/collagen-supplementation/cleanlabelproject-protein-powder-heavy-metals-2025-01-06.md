---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:cleanlabelproject-protein-powder-heavy-metals-2025-01-06
slug: sources/collagen-supplementation/cleanlabelproject-protein-powder-heavy-metals-2025-01-06
title: 'CLP Insights: 2024-25 Protein Powder Category Report'
summary: A Clean Label Project category report tested protein powders and reported elevated lead/cadmium patterns, including a collagen-protein subgroup signal.
status: draft
quality: usable
aliases:
- 'CLP Insights: 2024-25 Protein Powder Category Report'
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
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://cleanlabelproject.org/wp-content/uploads/CleanLabelProject_ProteinStudyWhitepaper_010625.pdf
  canonicalUrl: https://cleanlabelproject.org/wp-content/uploads/CleanLabelProject_ProteinStudyWhitepaper_010625.pdf
  identityAliases:
  - 'CLP Insights: 2024-25 Protein Powder Category Report'
source:
  kind: web_page
  title: 'CLP Insights: 2024-25 Protein Powder Category Report'
  authors: Clean Label Project
  citation: 'Clean Label Project. CLP Insights: 2024-25 Protein Powder Category Report. White paper. 2025.'
  year: 2025
  journal: Clean Label Project white paper
  url: https://cleanlabelproject.org/wp-content/uploads/CleanLabelProject_ProteinStudyWhitepaper_010625.pdf
researchEvidence:
  designKind: other
  designLabel: Non-peer-reviewed consumer product-testing report for protein powders
  populationLabel: 160 protein powder products from 70 top-selling brands, representing a reported 83% of the market
  durationLabel: 2024-2025 category testing report
  cohortKey: batch-009:cleanlabelproject-protein-powder-heavy-metals-2025-01-06
  participantCount: 160
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: safety-quality-contaminants
whyItMatters: Provides consumer-testing context for protein powder contaminant concerns but needs clear non-peer-reviewed and adjacent-evidence labeling.
potentialMurphEndpoints:
- safety:protein-powder-heavy-metals
- safety:collagen-protein-subgroup
- safety:consumer-testing
protocolTakeaway: Use source_artifact:cleanlabelproject-protein-powder-heavy-metals-2025-01-06 as adjacent/non-peer-reviewed product-quality context only.
murphTakeaway: Supports conservative buying guidance, not clinical risk estimates.
studyDesign: Non-peer-reviewed consumer product-testing report for protein powders
modality: protein powder category contaminant testing white paper
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

**Findings:** Population/exposure: 160 protein powder products from 70 top-selling brands, representing a reported 83% of the market Intervention or exposure: Commercial protein powder products, including plant, whey, collagen, and other categories. Comparator/control: Federal/state regulatory sets and California Proposition 65 thresholds. Duration/follow-up: 2024-2025 category testing report Endpoints: lead, cadmium, arsenic, mercury, bisphenols, contaminant panels. Direction/effect: The report states that 47% of products exceeded at least one federal or state safety set; it reports higher lead in plant-based and organic products and reports 26% of collagen protein powders over Proposition 65 for lead. Safety notes: No clinical adverse events; consumer product-quality testing only. Limitations: Non-peer-reviewed report.; Protein powder category is adjacent rather than collagen-specific overall.; Threshold methods and product selection require careful review before any product-specific claim.; Some Clean Label Project pages may describe product counts inconsistently.. Population mismatch: Product testing, not users; mostly adjacent protein powders.

**Why it matters:** Provides consumer-testing context for protein powder contaminant concerns but needs clear non-peer-reviewed and adjacent-evidence labeling.

**Potential experiment signals:** safety:protein-powder-heavy-metals, safety:collagen-protein-subgroup, safety:consumer-testing.

**Protocol takeaway:** Use source_artifact:cleanlabelproject-protein-powder-heavy-metals-2025-01-06 as adjacent/non-peer-reviewed product-quality context only.

**Claim use:** `safety-only`. Directness: `safety_boundary`. Rights status guess: `unknown`.
