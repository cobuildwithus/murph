{{SHARED_HEADER}}

TASK: Build the Health Commons protocol package.

Inputs:
- Charter from: {{CHARTER_SOURCE}}
- Canonical source ledger from: {{CANONICAL_LEDGER_SOURCE}}
- All source page drafts from: {{SOURCE_PAGE_DRAFTS_SOURCE}}
- Section synthesis outputs from: {{SECTION_SYNTHESIS_SOURCE}}
- Artifact candidates from: {{ARTIFACT_CANDIDATES_SOURCE}}
- SOURCE_FINDINGS_V1 and EVIDENCE_APPRAISALS_V1 outputs from extraction
- Generated source index: packages/health-commons/generated/source-index.json
- Existing Health Commons examples

Goal:
Draft the actual Health Commons files for {{PROTOCOL_NAME}}. Produce a landing-ready package, but do not skip citation, safety, or schema checks.

Files to draft:
1. packages/health-commons/content/families/{{FAMILY_SLUG}}.md, if missing
2. packages/health-commons/content/protocols/{{FAMILY_SLUG}}/{{PROTOCOL_SLUG}}.md
3. packages/health-commons/content/sources/{{FAMILY_SLUG}}/*.md
4. packages/health-commons/content/artifacts/{{FAMILY_SLUG}}/research-artifacts.json
5. packages/health-commons/content/evidence-appraisals/source-protocol-evidence/{{FAMILY_SLUG}}.jsonl
6. redirects or disambiguation page updates, if needed
7. missing biomarker pages only if genuinely absent and necessary
8. experimentOnboarding block if this protocol is intended to power Murph experiment creation

Protocol page requirements:
- one-sentence summary
- aliases
- categories
- parent family relation
- biomarker relations
- minimal foundational relations; claims, researchLandscape groups, and evidence appraisal edges carry source references
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

User-facing prose hygiene:
- User-facing Health Commons Markdown prose must not contain raw `source_artifact:*` tokens, `sourceKeys`, or `Source keys:` lines.
- This applies to protocol, family, and biomarker pages, including any missing biomarker pages drafted for the package.
- This includes summaries, steps, tips, keepInMind, whyItWorks, safety, family overview, non-claims, and explanatory paragraphs.
- Preserve source keys in structured frontmatter/JSONL fields only: relations, `claims.sourceKeys`, `researchLandscape.groups.sourceKeys`, source findings, evidence appraisals, and artifact manifests.
- If prose needs attribution, use readable source-card/study references rather than internal keys.
- Protocol frontmatter `summary` is shown as the `/experiments` card description. Keep it short and behavior/outcome-focused; do not repeat duration, session count, frequency, dose windows, or other timing already represented by test plans, metadata, `doseSignature`, or protocol fields.

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

## Evidence appraisals
Complete JSONL records for standalone protocol-specific appraisal edges.

## Artifact manifest
Complete JSON draft with rights-safe defaults.

## Non-claims
List tempting claims that should not be made.

Rules:
- No claim without source keys in structured source-key fields.
- Do not emit `protocolEvidence`; write standalone evidence-appraisal records for protocol-specific interpretation.
- Reuse existing sourceKeys from the generated source index instead of creating duplicate source pages.
- Keep external named protocols separate from Murph canonical protocols.
- Keep adjacent variants separate or clearly labeled.
- Make the steps human-actionable, not metadata repeated in prose.
- Do not make the protocol `summary` duplicate card metadata such as experiment length, session frequency, or dose timing.
- Keep safety stronger than efficacy when evidence is uncertain.
