{{SHARED_HEADER}}

TASK: Extract source pages and atomic findings for one source batch.

Batch:
- Batch ID: {{BATCH_ID}}
- Source keys: {{SOURCE_KEYS}}
- Maximum source count: 40
- Canonical source ledger input: {{CANONICAL_LEDGER_SOURCE}}
- Extraction batch source: {{BATCH_SOURCE}}

Goal:
For each source in this batch, create a Health Commons-ready source artifact draft and a set of atomic findings. Do not write the protocol synthesis yet.

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

## Atomic findings ledger
Return JSON named ATOMIC_FINDINGS_V1:

{
  "batchId": "{{BATCH_ID}}",
  "findings": [
    {
      "findingId": "finding:{{PROTOCOL_SLUG}}:{SOURCE_STABLE_ID}:001",
      "sourceKey": "source_artifact:...",
      "findingType": "dose | outcome | mechanism | safety | adverse_event | limitation | population | null_result | mixed_result",
      "population": "...",
      "n": "...",
      "intervention": "...",
      "comparator": "...",
      "endpoint": "...",
      "effectOrDirection": "...",
      "timeWindow": "...",
      "directness": "...",
      "claimUse": "...",
      "confidence": "low | moderate | high | unknown",
      "summary": "...",
      "limitations": ["..."],
      "supportsProtocolSection": ["dose", "safety", "outcomes", "mechanism", "things-to-watch"]
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
