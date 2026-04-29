{{SHARED_HEADER}}

TASK: Evidence QA blocker review.

Goal:
Block unsupported, overstated, miscited, or badly classified claims before landing.

Review:
- protocol package draft from:
{{PROTOCOL_PACKAGE_DRAFT_SOURCE}}
- claims from: {{CLAIMS_SOURCE}}
- researchLandscape
- source pages
- source-owned findings from: {{SOURCE_FINDINGS_SOURCE}}
- standalone evidence appraisals from: {{EVIDENCE_APPRAISALS_SOURCE}}
- generated source index at packages/health-commons/generated/source-index.json

Output:
1. Unsupported claims
2. Overstated claims
3. Claims using adjacent evidence as direct evidence
4. Missing null or mixed evidence
5. Missing important source pages
6. Source keys that do not exist
7. Findings whose claimUse classification should change
8. Evidence appraisals whose groupId or sourceKey does not match the protocol researchLandscape
9. Raw source-key leaks in user-facing Health Commons prose, including protocol, family, and biomarker pages, with exact replacement wording that preserves the claim but removes internal keys. Block visible labels or footnotes such as `Source keys:`, `Source key:`, `Citation key:`, `Citation keys:`, `Source artifact:`, and backticked `source_artifact:*` references.
10. Protocol frontmatter `summary:` problems when the field directly below `title:` does not follow `agent-docs/product-specs/protocol-summary-copy.md`.
11. Required edits, with exact replacement wording

Rules:
- Be skeptical.
- Prefer downgrading claim strength over deleting useful nuance.
- Do not add new claims unless they cite source keys.
- Do not treat structured `sourceKeys` fields as leaks; only block raw keys, source-key labels, and source-ID footnotes in user-facing prose/body copy.
- Do not reintroduce `protocolEvidence`; protocol-specific interpretation belongs in standalone evidence-appraisal records.
