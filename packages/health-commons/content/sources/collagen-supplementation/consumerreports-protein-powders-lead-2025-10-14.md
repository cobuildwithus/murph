---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:consumerreports-protein-powders-lead-2025-10-14
slug: sources/collagen-supplementation/consumerreports-protein-powders-lead-2025-10-14
title: Protein Powders and Shakes Contain High Levels of Lead
summary: Consumer Reports tested 23 protein supplements and reported lead as the main concern, with many products above CR's own daily level of concern.
status: draft
quality: usable
aliases:
- Protein Powders and Shakes Contain High Levels of Lead
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
    url: https://www.consumerreports.org/health/protein-powders-shakes/protein-powders-and-shakes-contain-high-levels-of-lead-a8228705319/
  canonicalUrl: https://www.consumerreports.org/health/protein-powders-shakes/protein-powders-and-shakes-contain-high-levels-of-lead-a8228705319/
  identityAliases:
  - Protein Powders and Shakes Contain High Levels of Lead
source:
  kind: web_page
  title: Protein Powders and Shakes Contain High Levels of Lead
  authors: Consumer Reports
  citation: Consumer Reports. Protein Powders and Shakes Contain High Levels of Lead. October 14, 2025.
  year: 2025
  journal: Consumer Reports
  url: https://www.consumerreports.org/health/protein-powders-shakes/protein-powders-and-shakes-contain-high-levels-of-lead-a8228705319/
researchEvidence:
  designKind: other
  designLabel: Consumer Reports testing of protein powders and ready-to-drink shakes
  populationLabel: 23 bestselling dairy-, beef-, and plant-based protein powders/shakes purchased anonymously from retail sources
  durationLabel: Samples purchased over a three-month period beginning in November 2024
  cohortKey: batch-009:consumerreports-protein-powders-lead-2025-10-14
  participantCount: 23
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: safety-quality-contaminants
whyItMatters: High-visibility adjacent product-quality context that should be kept separate from direct collagen peptide evidence.
potentialMurphEndpoints:
- safety:lead
- safety:protein-powder-contaminants
- safety:consumer-testing
protocolTakeaway: Use source_artifact:consumerreports-protein-powders-lead-2025-10-14 as adjacent protein-powder contaminant context only.
murphTakeaway: Useful for buyer guidance and caution with daily powder use, while avoiding overclaiming.
studyDesign: Consumer Reports testing of protein powders and ready-to-drink shakes
modality: protein supplement consumer contaminant testing
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

**Findings:** Population/exposure: 23 bestselling dairy-, beef-, and plant-based protein powders/shakes purchased anonymously from retail sources Intervention or exposure: Commercial protein powders and ready-to-drink protein shakes. Comparator/control: Consumer Reports level of concern for lead and other heavy-metal thresholds. Duration/follow-up: Samples purchased over a three-month period beginning in November 2024 Endpoints: lead, cadmium, inorganic arsenic, total protein, serving-based weekly limits. Direction/effect: About 70% of tested products contained more than 120% of CR's 0.5 microgram/day lead level of concern; plant-based products averaged higher lead than dairy-based products. Safety notes: No clinical adverse events; contaminant product testing only. Limitations: Consumer testing, not peer-reviewed clinical research.; Protein-powder category overall; not collagen-specific.; CR threshold is a risk-assessment choice and not identical to federal limits or Prop 65 judgments.; Snapshot over specific lots and purchase period.. Population mismatch: Products rather than human collagen users.

**Why it matters:** High-visibility adjacent product-quality context that should be kept separate from direct collagen peptide evidence.

**Potential experiment signals:** safety:lead, safety:protein-powder-contaminants, safety:consumer-testing.

**Protocol takeaway:** Use source_artifact:consumerreports-protein-powders-lead-2025-10-14 as adjacent protein-powder contaminant context only.

**Claim use:** `safety-only`. Directness: `safety_boundary`. Rights status guess: `unknown`.
