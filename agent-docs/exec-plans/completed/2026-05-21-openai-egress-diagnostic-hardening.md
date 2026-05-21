# OpenAI Egress Diagnostic Hardening

## Goal

Harden the OpenAI egress diagnostic follow-up from subagent review so tool-size
metadata cannot emit arbitrary raw function names and function output attribution
is deterministic for unusual call ordering or duplicate call ids.

## Constraints

- Preserve existing metadata-only diagnostic shape.
- Do not log prompt text, message text, raw tool output, raw call ids, request
  bodies, user ids, secrets, local paths, object keys, or arbitrary function
  names.
- Preserve unrelated dirty worktree edits.

## Plan

1. Normalize function names to fixed diagnostic categories only.
2. Build call-id attribution from a complete pre-scan and surface duplicate ids.
3. Add function-call byte attribution and regression tests for privacy and odd
   ordering.
4. Run focused Cloudflare tests and diff-aware verification.
5. Commit only the scoped hardening change and plan closeout.

## Verification

- `pnpm --dir apps/cloudflare test:node apps/cloudflare/test/runner-egress-intercept.test.ts`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/test/runner-egress-intercept.test.ts agent-docs/exec-plans/active/2026-05-21-openai-egress-diagnostic-hardening.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-05-21
Completed: 2026-05-21
