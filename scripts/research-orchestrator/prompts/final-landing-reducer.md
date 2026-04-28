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
- Before producing the final diff, remove raw `source_artifact:*` keys, `sourceKeys`, and `Source keys:` labels from all user-facing Health Commons prose, including protocol, family, and biomarker pages, while preserving structured source-key fields and JSON/JSONL traceability.
- Before producing the final diff, check each protocol frontmatter `summary` as `/experiments` card copy: it should describe the behavior, outcome, or safety posture without repeating duration, session count, frequency, dose windows, or other timing already shown in metadata, `doseSignature`, test plans, or protocol fields.
- Do not reintroduce `protocolEvidence` or duplicate source pages while applying blocker fixes.
- Preserve the <=40-source-per-extraction-run guarantee in the work log.
- Include verification commands:
  - pnpm --filter @murphai/health-commons generate
  - pnpm --filter @murphai/health-commons generate:check
  - pnpm --filter @murphai/health-commons artifacts:r2:dry-run when the artifact manifest changes
