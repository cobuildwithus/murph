# OpenAI Egress Tool Diagnostics

## Goal

Add clean, metadata-only hosted OpenAI egress diagnostics that identify which
Responses input item/tool-output categories are bloating costly assistant turns,
without storing prompt text, message text, raw tool output, raw call ids, raw
provider payloads, or user identifiers.

## Constraints

- Preserve existing prompt-cache and request-size diagnostics.
- Keep diagnostics composable in the existing `runner.provider_egress_diagnostic`
  event.
- Log only bounded metadata: counts, byte totals, type/tool-name categories, and
  largest-item sizes.
- Do not touch unrelated active `apps/web` working-tree edits.

## Plan

1. Inspect the existing Cloudflare egress diagnostic code and tests.
2. Add function-call/output size attribution by sanitized tool name.
3. Add focused tests for the new fields and privacy boundaries.
4. Run focused verification for the touched Cloudflare slice.
5. Commit only the scoped diagnostics change and plan closeout.

## Verification

- `pnpm --dir apps/cloudflare test:node apps/cloudflare/test/runner-egress-intercept.test.ts`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/test/runner-egress-intercept.test.ts agent-docs/exec-plans/active/2026-05-21-openai-egress-tool-diagnostics.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-05-21
Completed: 2026-05-21
