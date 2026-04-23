{{SHARED_HEADER}}

TASK: Source discovery shard.

Shard:
- Shard ID: {{SHARD_ID}}
- Shard topic: {{SHARD_TOPIC}}
- Query strings:
{{SHARD_QUERY_STRINGS}}
- Prioritize source types:
{{SHARD_SOURCE_TYPES}}
- Direct evidence in this shard:
{{SHARD_DIRECT_EVIDENCE}}
- Adjacent or boundary evidence in this shard:
{{SHARD_ADJACENT_EVIDENCE}}
- Likely endpoint families:
{{SHARD_ENDPOINT_FAMILIES}}

Goal:
Find the broadest defensible set of peer-reviewed, guideline, trial, review, and high-quality academic sources for this shard. Maximize recall. Do not extract findings yet except for very short relevance notes.

Search priorities:
1. PubMed or MEDLINE
2. PubMed Central or open full text
3. Crossref or DOI records
4. Systematic reviews and meta-analyses
5. Clinical or professional guidelines
6. Trial registries where relevant
7. Major journals and credible review venues

Output:

## Search log
- databases searched
- exact searches used
- terms that worked
- terms that were noisy
- gaps still open

## Candidate source ledger rows
Return a JSON block named SOURCE_CANDIDATES_V1:

{
  "protocolKey": "protocol_variant:{{FAMILY_SLUG}}/{{PROTOCOL_SLUG}}",
  "shardId": "{{SHARD_ID}}",
  "records": [
    {
      "candidateId": "candidate:{{SHARD_ID}}:001",
      "proposedSourceKey": "source_artifact:...",
      "title": "...",
      "authors": "...",
      "year": 2024,
      "journalOrVenue": "...",
      "doi": null,
      "pmid": null,
      "pmcid": null,
      "url": "...",
      "sourceKind": "journal_article | review | guideline | trial_registry | web_page | other",
      "studyDesignGuess": "systematic_review | meta_analysis | rct | crossover | cohort | case_report | acute_physiology | mechanistic | guideline | narrative_review | other",
      "populationGuess": "...",
      "interventionOrExposureGuess": "...",
      "endpointGuess": ["..."],
      "relevanceGuess": "high | medium | low | exclude",
      "directnessGuess": "direct_protocol | same_mechanism | adjacent_variant | safety_boundary | background",
      "claimUseGuess": "supports-protocol | safety-only | context-only | do-not-use | unknown",
      "whyItMightMatter": "...",
      "openAccessPdfUrl": null,
      "pdfRightsStatusGuess": "open_access | permission_required | paywalled | unknown"
    }
  ]
}

Also attach one downloadable JSON file named `source_candidates_v1.json` containing exactly the `SOURCE_CANDIDATES_V1` object and no Markdown fence. Treat that file as the canonical machine-readable output for this seam.

## Top candidates
Rank the 20 most important records from this shard.

Rules:
- Do not remove older foundational sources just because newer reviews exist.
- Include null, negative, and mixed sources.
- Include safety papers and adverse-event reports even if they do not support the protocol.
- Do not exceed discovery scope by writing final claims.
