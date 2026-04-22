{{SHARED_HEADER}}

TASK: Build the protocol research charter and extraction plan.

Goal:
Create the research map for {{PROTOCOL_NAME}} before any source extraction. Do not write the protocol page yet.

Initial identity hints:
{{INITIAL_IDENTITY_HINTS}}

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

Machine-readable outputs:
Return the following JSON blocks exactly once, using these exact headings and fenced `json` code blocks:

## CHARTER_MANIFEST_V1
```json
{
  "protocolName": "{{PROTOCOL_NAME}}",
  "protocolSlug": "{{PROTOCOL_SLUG}}",
  "familySlug": "{{FAMILY_SLUG}}",
  "protocolAliases": ["..."],
  "variantDecision": "single_protocol | split_variants | unclear",
  "notes": ["..."]
}
```

## SEARCH_SHARDS_V1
```json
{
  "shards": [
    {
      "id": "direct-intervention",
      "topic": "...",
      "queryStrings": ["..."],
      "sourceTypes": ["..."],
      "directEvidence": ["..."],
      "adjacentEvidence": ["..."],
      "endpointFamilies": ["..."]
    }
  ]
}
```

## SECTION_SEAMS_V1
```json
{
  "sections": [
    {
      "id": "dose-implementation",
      "focus": "..."
    }
  ]
}
```

## SOURCE_EXTRACTION_SCHEMA_V1
```json
{
  "fields": ["source metadata", "researchEvidence", "protocolEvidence"]
}
```

## INITIAL_FILE_PLAN_V1
```json
{
  "files": [
    {
      "kind": "protocol_page",
      "path": "packages/health-commons/content/protocols/{{FAMILY_SLUG}}/{{PROTOCOL_SLUG}}.md",
      "why": "..."
    }
  ]
}
```

Rules:
- Use the prose charter sections plus the machine-readable blocks.
- The machine-readable blocks define the later seams for `research:materialize`.
- If the provisional slugs above are wrong, replace them in `CHARTER_MANIFEST_V1`.
- Do not synthesize recommendations yet.
