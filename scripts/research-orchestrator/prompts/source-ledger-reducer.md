{{SHARED_HEADER}}

TASK: Build the canonical source ledger and extraction batches.

Inputs:
- All SOURCE_CANDIDATES_V1 outputs from: {{DISCOVERY_OUTPUTS_SOURCE}}
- Protocol charter from: {{CHARTER_SOURCE}}
- Existing source page inventory from: {{EXISTING_SOURCE_PAGE_INVENTORY_SOURCE}}

Goal:
Create one deduped source ledger and split it into extraction batches of no more than 40 records each.

Dedupe rules:
1. Same PMID wins over duplicate DOI or title rows.
2. Same DOI without PMID becomes one DOI source.
3. Same PMCID without PMID or DOI becomes one PMCID source.
4. Same trial registration plus publication should be linked but not blindly merged.
5. Reviews and the individual trials inside them remain separate records.
6. External protocol or web sources should be dated by publication or snapshot date.

Output:

## Canonical source ledger
Return JSON named CANONICAL_SOURCE_LEDGER_V1:

{
  "protocolKey": "protocol_variant:{{FAMILY_SLUG}}/{{PROTOCOL_SLUG}}",
  "familyKey": "experiment_family:{{FAMILY_SLUG}}",
  "sourceCount": 0,
  "records": [
    {
      "sourceKey": "source_artifact:...",
      "relativePath": "sources/{{FAMILY_SLUG}}/....md",
      "title": "...",
      "canonicalIdBasis": "pmid | doi | pmcid | url | manual",
      "doi": null,
      "pmid": null,
      "pmcid": null,
      "url": "...",
      "sourceKind": "...",
      "studyDesign": "...",
      "evidenceBucket": "...",
      "directness": "direct_protocol | same_mechanism | adjacent_variant | clinical_supervised | safety_boundary | background",
      "claimUse": "supports-protocol | safety-only | context-only | do-not-use",
      "priority": "backbone | high | medium | low | exclude",
      "needsSourcePage": true,
      "needsArtifactManifestEntry": false,
      "artifactRightsStatusGuess": "open_access | permission_required | paywalled | unknown",
      "batchId": "batch-001",
      "notes": "..."
    }
  ]
}

## Extraction batches
Return JSON named SOURCE_EXTRACTION_BATCHES_V1:

{
  "batches": [
    {
      "batchId": "batch-001",
      "theme": "Direct protocol and dose evidence",
      "recordCount": 0,
      "sourceKeys": ["source_artifact:..."],
      "whyThisBatch": "...",
      "mustNotExceed": 40
    }
  ]
}

Also attach two downloadable JSON files:
- `canonical_source_ledger_v1.json` containing exactly `CANONICAL_SOURCE_LEDGER_V1`
- `source_extraction_batches_v1.json` containing exactly `SOURCE_EXTRACTION_BATCHES_V1`

Treat those files as the canonical machine-readable seam outputs for this reducer.

Batching rules:
- No batch may exceed 40 records.
- Put dense systematic reviews in smaller batches if they require heavy extraction.
- Keep direct evidence separate from adjacent, mechanistic, and safety evidence when possible.
- Put safety or adverse-event sources in their own batch if there are enough.
- Mark excluded records but do not send excluded records to extraction unless needed for a why-excluded note.

## Work order
List which batches can run in parallel and which should run first.
