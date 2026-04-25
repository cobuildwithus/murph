{{SHARED_HEADER}}

TASK: Build the canonical source ledger and extraction batches.

Inputs:
- All SOURCE_CANDIDATES_V1 outputs from: {{DISCOVERY_OUTPUTS_SOURCE}}
- Protocol charter from: {{CHARTER_SOURCE}}
- Existing source page inventory from: {{EXISTING_SOURCE_PAGE_INVENTORY_SOURCE}}
- Generated source index from `packages/health-commons/generated/source-index.json`

Goal:
Create one deduped source ledger and split it into extraction batches of no more than 40 records each. Every candidate must resolve through the generated source index before any fetch, extraction, or new source-page assignment.

Dedupe rules:
1. Normalize PMID, DOI, PMCID, registry ID, canonical URL, and title hash. Use 64-character lowercase hex for `titleHash`.
2. Check `source-index.json.identityLookup` first.
3. If a lookup has one `canonicalSourceKey`, reuse that source key and its existing artifact/finding state.
4. If `canonicalSourceKey` is null or multiple `sourceKeys` match, mark the candidate ambiguous and require explicit canonicalization before extraction.
5. Same PMID wins over duplicate DOI or title rows.
6. Same DOI without PMID becomes one DOI source.
7. Same PMCID without PMID or DOI becomes one PMCID source.
8. Same trial registration plus publication should be linked but not blindly merged.
9. Reviews and the individual trials inside them remain separate records.
10. External protocol or web sources should be dated by publication or snapshot date.

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
      "canonicalIdBasis": "pmid | doi | pmcid | registry_id | title_hash | url",
      "doi": null,
      "pmid": null,
      "pmcid": null,
      "registryId": null,
      "titleHash": null,
      "url": "...",
      "canonicalSourceKey": null,
      "identityResolutionStatus": "existing_source | new_source | ambiguous",
      "sourceKind": "...",
      "studyDesign": "...",
      "evidenceBucket": "...",
      "directness": "direct_protocol | same_mechanism | clinical_supervised | adjacent_variant | measurement_context | general_guideline",
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
