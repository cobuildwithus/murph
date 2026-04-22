{{SHARED_HEADER}}

TASK: Build the Health Commons protocol package.

Inputs:
- Charter from: {{CHARTER_SOURCE}}
- Canonical source ledger from: {{CANONICAL_LEDGER_SOURCE}}
- All source page drafts from: {{SOURCE_PAGE_DRAFTS_SOURCE}}
- Section synthesis outputs from: {{SECTION_SYNTHESIS_SOURCE}}
- Artifact candidates from: {{ARTIFACT_CANDIDATES_SOURCE}}
- Existing Health Commons examples

Goal:
Draft the actual Health Commons files for {{PROTOCOL_NAME}}. Produce a landing-ready package, but do not skip citation, safety, or schema checks.

Files to draft:
1. packages/health-commons/content/families/{{FAMILY_SLUG}}.md, if missing
2. packages/health-commons/content/protocols/{{FAMILY_SLUG}}/{{PROTOCOL_SLUG}}.md
3. packages/health-commons/content/sources/{{FAMILY_SLUG}}/*.md
4. packages/health-commons/content/artifacts/{{FAMILY_SLUG}}/research-artifacts.json
5. redirects or disambiguation page updates, if needed
6. missing biomarker pages only if genuinely absent and necessary
7. experimentOnboarding block if this protocol is intended to power Murph experiment creation

Protocol page requirements:
- one-sentence summary
- aliases
- categories
- parent family relation
- biomarker relations
- cites relations
- lineage
- attribution
- protocol block:
  - doseSignature
  - target
  - frequency
  - duration or intensity or temperature where relevant
  - intervention session minimum or target
  - human-readable steps
  - tips
  - keepInMind
  - logFields
  - stopConditions
- at least one testPlan
- experimentOnboarding when the protocol should be runnable in Murph
- whyItWorks
- claims
- researchLandscape
- safety

Output:

## File manifest
Table with path, create or update, and purpose.

## Draft protocol page
Complete Markdown.

## Draft family page
Complete Markdown or "no change needed."

## Source pages
List all source pages and whether each is:
- new
- update existing
- skip or already present

## Artifact manifest
Complete JSON draft with rights-safe defaults.

## Non-claims
List tempting claims that should not be made.

Rules:
- No claim without source keys.
- Keep external named protocols separate from Murph canonical protocols.
- Keep adjacent variants separate or clearly labeled.
- Make the steps human-actionable, not metadata repeated in prose.
- Keep safety stronger than efficacy when evidence is uncertain.
