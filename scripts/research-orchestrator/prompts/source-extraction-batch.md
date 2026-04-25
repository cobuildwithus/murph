{{SHARED_HEADER}}

TASK: Extract source pages and atomic findings for one source batch.

Batch:
- Batch ID: {{BATCH_ID}}
- Source keys: {{SOURCE_KEYS}}
- Maximum source count: 40
- Canonical source ledger input: {{CANONICAL_LEDGER_SOURCE}}
- Extraction batch source: {{BATCH_SOURCE}}
- Generated source index: packages/health-commons/generated/source-index.json

Goal:
For each source in this batch, create or update a Health Commons-ready source artifact draft, reusable source-owned findings, and standalone evidence appraisal edges. Do not write the protocol synthesis yet. Resolve each source against the generated source index first; if `source-index.json.identityLookup` contains one `canonicalSourceKey` for a normalized PMID, DOI, PMCID, registry ID, title hash, or canonical URL, reuse that sourceKey and its existing artifact/finding state instead of refetching or duplicating the source page.

For each source, extract:
- canonical metadata: title, authors, year, journal or venue, DOI, PMID, PMCID, URL, citation
- source kind
- study design
- participant count and count kind
- population
- intervention or exposure
- comparator or control
- duration or follow-up
- endpoints
- effect estimates or direction where available
- adverse events or safety notes
- limitations
- population mismatch
- directness to {{PROTOCOL_NAME}}
- claimUse boundary
- artifact candidates and rights status

Output for each source:

## Source page draft
Return Markdown for:
packages/health-commons/content/sources/{{FAMILY_SLUG}}/{SOURCE_SLUG}.md

Use this shape:

---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:...
slug: sources/{{FAMILY_SLUG}}/...
title: "..."
summary: "..."
status: draft
quality: usable
aliases:
  - "..."
categories:
  - {{FAMILY_SLUG}}
relations:
  -
    type: related_protocol
    target: protocol_variant:{{FAMILY_SLUG}}/{{PROTOCOL_SLUG}}
  -
    type: parent_family
    target: experiment_family:{{FAMILY_SLUG}}
source:
  kind: journal_article
  title: "..."
  authors: "..."
  year: 2024
  journal: "..."
  citation: "..."
  pmid: "..."
  doi: "..."
  url: "..."
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: pmid | doi | pmcid | registry_id | title_hash | url
  identifiers:
    pmid: "..."
    doi: "..."
    pmcid: "..."
    registryId: "..."
    titleHash: "64-character lowercase hex when title_hash is the canonical basis"
    url: "..."
  canonicalUrl: "..."
researchEvidence:
  designKind: "..."
  designLabel: "..."
  participantCount: 0
  participantCountKind: reported
  populationLabel: "..."
  durationLabel: "..."
  aggregateRole: primary
  cohortKey: "..."
evidenceBucket: "..."
whyItMatters: "..."
potentialMurphEndpoints:
  - "..."
protocolTakeaway: "..."
murphTakeaway: "..."
studyDesign: "..."
modality: "..."
claimUse: supports-protocol | safety-only | context-only | do-not-use
sourceFindings:
  -
    findingId: finding:...
    sourceKey: source_artifact:...
    extractedFromArtifactId: art_...
    findingKind: adverse_event | context | intervention_result | measurement_validation | mechanistic | safety | other
    population: "..."
    exposure: "..."
    outcome: "..."
    summary: "..."
    evidenceUse:
      - efficacy
murphV1Priority: High | Medium | Low
pdfRightsStatus: open_access | permission_required | paywalled | unknown
---

For every source page that supports a researchLandscape group, also emit a
standalone evidence-appraisal JSONL record under
`packages/health-commons/content/evidence-appraisals/source-protocol-evidence/{{FAMILY_SLUG}}.jsonl`.
Each record must use schema `murph.commons.evidence-appraisal.v1`, a key prefixed
`evidence_appraisal:`, the source page key, target protocol key
`protocol_variant:{{FAMILY_SLUG}}/{{PROTOCOL_SLUG}}`, targetKind `protocol_variant`,
groupId, stance, scope, result, endpointKeys, headline, implication, optional
caveat, and displayPriority.

This source is included for **{evidenceBucket}**.

**Findings:** ...

**Why it matters:** ...

**Potential experiment signals:** ...

**Protocol takeaway:** ...

**Claim use:** `...`.

## Source findings ledger
Return JSON named SOURCE_FINDINGS_V1. These records should be source-owned and reusable across future protocols:

{
  "batchId": "{{BATCH_ID}}",
  "findings": [
    {
      "findingId": "finding:...",
      "sourceKey": "source_artifact:...",
      "extractedFromArtifactId": "art_...",
      "findingKind": "adverse_event | context | intervention_result | measurement_validation | mechanistic | safety | other",
      "population": "...",
      "exposure": "...",
      "outcome": "...",
      "summary": "...",
      "evidenceUse": ["adjacent_variant | context | efficacy | mechanism | measurement | safety"]
    }
  ]
}

## Evidence appraisals ledger
Return JSON named EVIDENCE_APPRAISALS_V1. These records belong in packages/health-commons/content/evidence-appraisals/source-protocol-evidence/{{FAMILY_SLUG}}.jsonl, not in source page frontmatter:

{
  "batchId": "{{BATCH_ID}}",
  "appraisals": [
    {
      "schemaVersion": "murph.commons.evidence-appraisal.v1",
      "key": "evidence_appraisal:...",
      "sourceKey": "source_artifact:...",
      "targetKey": "protocol_variant:{{FAMILY_SLUG}}/{{PROTOCOL_SLUG}}",
      "targetKind": "protocol_variant",
      "groupId": "...",
      "stance": "supports | mixed | does_not_confirm | contradicts | safety_boundary | context_only",
      "scope": "direct_protocol | same_mechanism | clinical_supervised | adjacent_variant | measurement_context | general_guideline",
      "result": "positive | mixed | no_clear_advantage | negative | not_efficacy_evidence",
      "endpointKeys": ["biomarker:..."],
      "findingKeys": ["finding:..."],
      "headline": "...",
      "implication": "...",
      "caveat": "...",
      "displayPriority": 10
    }
  ]
}

## Artifact manifest candidates
Return JSON named ARTIFACT_CANDIDATES_V1 for only the sources in this batch.

Rules:
- No source extraction batch may process more than 40 sources.
- Do not synthesize across sources.
- Do not promote adjacent-variant findings into direct protocol claims.
- Do not claim causality from observational or mechanistic evidence.
- Flag all uncertainty explicitly.
- Do not emit `protocolEvidence`; source pages use source-owned `sourceFindings`, and protocol-specific interpretation lives in standalone evidence-appraisal records.
