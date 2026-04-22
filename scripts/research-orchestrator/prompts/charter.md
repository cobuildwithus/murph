{{SHARED_HEADER}}

TASK: Build the protocol research charter and extraction plan.

Goal:
Create the research map for {{PROTOCOL_NAME}} before any source extraction. Do not write the protocol page yet.

Preset starting points:
{{PRESET_STARTING_POINTS}}

Inputs:
- The Health Commons schema expectations from existing protocol and source pages.
- The target protocol name and family.
- Any existing notes in the repo for this protocol, if present.

Output sections:

## 1. Protocol scope
Define:
- included intervention names and aliases
- excluded or adjacent interventions
- direct protocol definition
- likely family page name
- whether this should be one protocol or multiple variants

## 2. PICOTS-style research frame
Return:
- Population
- Intervention
- Comparator
- Outcomes
- Timing
- Setting
- Safety population boundaries

## 3. Outcome map
Create a table:
- outcome
- candidate biomarker key
- primary or secondary or exploratory
- wearable or manual or lab measurability
- expected latency
- confounders

## 4. Search-shard plan
Return 6 to 10 discovery shards. For each shard:
- shard ID
- search purpose
- exact query strings
- source types to prioritize
- what would count as direct vs adjacent evidence
- likely endpoint families

## 5. Source extraction schema
Define the fields every later source batch must extract:
- source metadata
- researchEvidence
- protocolEvidence
- finding IDs
- directness
- claimUse
- artifact candidates
- safety or adverse events
- limitations

## 6. Initial file plan
List likely files to create or update:
- family page
- protocol page
- source pages
- artifact manifest
- disambiguation or redirects if needed
- biomarkers if missing
- experimentOnboarding block if this protocol is expected to power Murph experiment creation

Return only the charter and machine-readable search plan. Do not synthesize recommendations yet.
