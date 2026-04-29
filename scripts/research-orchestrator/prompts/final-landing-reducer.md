{{SHARED_HEADER}}

TASK: Final landing reducer.

Inputs:
- Protocol package draft from:
{{PROTOCOL_PACKAGE_DRAFT_SOURCE}}
- Evidence QA from: {{EVIDENCE_QA_SOURCE}}
- Safety QA from: {{SAFETY_QA_SOURCE}}

Goal:
Produce the final repo patch and final punchlist.

QA policy:
- Treat Evidence QA and Safety QA as the single QA pass for this package.
- Apply their blocker fixes directly in this reducer instead of requesting or waiting for a second QA pass.
- If the protocol package draft is a repaired page-builder rerun, use the repaired package as current and use the original QA reports as the blocker checklist.

Output:
1. Final file manifest
2. Final unified diff
3. Final artifact manifest JSON
4. Final source ledger JSON
5. Final evidence-appraisal JSONL records
6. Final verification checklist
7. Remaining non-blocking follow-ups

Rules:
- Apply all blocker fixes.
- Do not add new unsupported claims while fixing text.
- Do not request post-repair Evidence QA or Safety QA unless the operator explicitly asks for a second QA pass.
- Keep all extraction batches traceable through source keys, finding IDs, and appraisal keys.
- Before producing the final diff, remove raw `source_artifact:*` keys, `sourceKeys`, source-key labels, and source-ID footnotes from all user-facing Health Commons prose, including protocol, family, and biomarker pages, while preserving structured source-key fields and JSON/JSONL traceability.
- Treat any visible `Source keys:`, `Source key:`, `Citation key:`, `Citation keys:`, `Source artifact:`, or backticked `source_artifact:*` text in public copy as a blocker. Rewrite it into plain user-facing wording, and keep the provenance only in structured fields.
- Before producing the final diff, check each protocol frontmatter `summary:` field directly below `title:` against `agent-docs/product-specs/protocol-summary-copy.md`.
- Before producing the final diff, check each protocol's expected biomarker signals against the associated Health Commons research. Pick primary and secondary markers from the evidence, prefer objective and easily measured markers for the main UI cards, keep self-referential adherence or exposure markers out of primary outcomes, and leave contextual or subjective markers in `also worth watching` unless they are clearly central to the protocol.
- For promoted biomarkers, make `estimatedChange` and the mechanism description evidence-shaped instead of hand-wavy. Populate numeric bounds only when the protocol research directly supports them; otherwise use `kind: mixed_or_contextual` or omit the estimate. Do not hard-code ranges like `5-10%` unless the research directly supports them. Explain why the protocol could move the marker in plain language, using softer labels such as `Possible change`, `Could improve`, or `Could trend lower` when the evidence is mixed or indirect.
- Do not reintroduce `protocolEvidence` or duplicate source pages while applying blocker fixes.
- Preserve the <=40-source-per-extraction-run guarantee in the work log.
- Include verification commands:
  - pnpm --filter @murphai/health-commons generate
  - pnpm --filter @murphai/health-commons generate:check
  - pnpm --filter @murphai/health-commons artifacts:r2:dry-run when the artifact manifest changes
