{{SHARED_HEADER}}

TASK: Section synthesis.

Section:
- Section ID: {{SECTION_ID}}
- Section focus: {{SECTION_FOCUS}}

Allowed source material:
- CANONICAL_SOURCE_LEDGER_V1 from: {{CANONICAL_LEDGER_SOURCE}}
- SOURCE_FINDINGS_V1 outputs from: {{SOURCE_FINDINGS_SOURCE}}
- EVIDENCE_APPRAISALS_V1 outputs from: {{EVIDENCE_APPRAISALS_SOURCE}}
- Draft source pages from extraction batches at: {{SOURCE_PAGE_DRAFTS_SOURCE}}
- Generated source index at packages/health-commons/generated/source-index.json
- Existing Health Commons schema and page patterns

Goal:
Synthesize only this section of the protocol. Do not write the full protocol page.

Output:

## Section bottom line
One paragraph for this section.

## Claims proposed
Return JSON named SECTION_CLAIMS_V1:

{
  "sectionId": "{{SECTION_ID}}",
  "claims": [
    {
      "claimId": "...",
      "type": "association_not_causation | design_guardrail | evidence_scope | intervention_result | mechanistic | mixed_evidence | safety",
      "text": "...",
      "strength": "low | moderate | high | unknown",
      "sourceKeys": ["source_artifact:..."],
      "findingIds": ["finding:..."],
      "caveats": ["..."],
      "shouldLandOnProtocolPage": true
    }
  ]
}

## Research landscape group draft
Return any group that belongs in researchLandscape.groups:
- id
- label
- stance
- summary
- sourceKeys
- defaultOpen

Any researchLandscape group that lists sourceKeys must be backed by matching EVIDENCE_APPRAISALS_V1 records with the same target protocol, groupId, and sourceKey.

## Human-readable copy
Draft concise copy for the protocol page:
- what this means
- what could improve
- what to watch
- what not to conclude

Do not append bracketed, parenthetical, or labeled raw source-key dumps to this copy. Keep raw source keys only in `SECTION_CLAIMS_V1` and structured researchLandscape group drafts.

## Conflicts and caveats
List conflicting evidence and how the final protocol should phrase it.

## Source coverage gaps
List missing sources or missing extraction details that block confident synthesis.

Rules:
- Every claim must carry machine-readable `sourceKeys` in structured outputs, but the human-readable copy must not expose raw `source_artifact:*` keys or `Source keys:` labels.
- Prefer source-owned finding IDs plus appraisal keys for traceability when proposing claims.
- Do not introduce new claims from memory.
- Do not overrule extraction classifications unless you explain exactly why.
