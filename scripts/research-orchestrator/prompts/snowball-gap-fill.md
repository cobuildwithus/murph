{{SHARED_HEADER}}

TASK: Snowball discovery and gap fill.

Inputs:
- Candidate source ledgers from prior discovery shards.
- Backbone papers or reviews to snowball from: {{BACKBONE_SOURCE_KEYS_OR_TITLES}}
- Known gaps: {{KNOWN_GAPS}}

Goal:
Find important sources missed by keyword search. Use backward references, forward citations, review bibliographies, guidelines, trial registrations, and author clusters.

Output:

## Additions
Return SOURCE_CANDIDATES_V1 rows for newly found records only.

## Corrections
Return corrections for existing candidate rows:
- duplicate DOI or PMID or PMCID
- wrong year or title
- wrong source key
- wrong directness
- wrong claim-use classification
- source should be excluded

## Missing-source diagnosis
For each evidence area, say whether source coverage is:
- probably sufficient
- probably thin
- biased toward one population
- too adjacent to support protocol claims
- missing safety or adverse-event coverage
- missing dose-response coverage
- missing wearable-relevant outcomes

## Variant split notes
List any evidence clusters that probably deserve separate protocols or disambiguation options.

Rules:
- Do not synthesize the protocol.
- Do not extract detailed findings yet.
- Preserve sources even when they weaken the protocol; mark them as mixed, null, safety-only, or context-only.
