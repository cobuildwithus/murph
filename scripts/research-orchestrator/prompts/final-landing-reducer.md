{{SHARED_HEADER}}

TASK: Final landing reducer.

Inputs:
- Protocol package draft from:
{{PROTOCOL_PACKAGE_DRAFT_SOURCE}}
- Evidence QA from: {{EVIDENCE_QA_SOURCE}}
- Safety QA from: {{SAFETY_QA_SOURCE}}
- Schema and artifact QA from: {{SCHEMA_ARTIFACT_QA_SOURCE}}

Goal:
Produce the final repo patch and final punchlist.

Output:
1. Final file manifest
2. Final unified diff
3. Final artifact manifest JSON
4. Final source ledger JSON
5. Final verification checklist
6. Remaining non-blocking follow-ups

Rules:
- Apply all blocker fixes.
- Do not add new unsupported claims while fixing text.
- Keep all extraction batches traceable through source keys and finding IDs.
- Preserve the <=40-source-per-extraction-run guarantee in the work log.
- Include verification commands:
  - pnpm --filter @murphai/health-commons generate
  - pnpm --filter @murphai/health-commons generate:check
  - pnpm --filter @murphai/health-commons artifacts:r2:dry-run when the artifact manifest changes
