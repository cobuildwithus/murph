# OpenAI Egress Function Names

## Goal

Improve OpenAI egress diagnostics by logging exact function/tool names when they
are safe diagnostic metadata, while still avoiding raw tool calls, arguments,
outputs, call ids, prompts, messages, request bodies, user identifiers, secrets,
paths, and object keys.

## Constraints

- Preserve bounded shallow `runner.provider_egress_diagnostic` metadata.
- Collapse secret-shaped, path-shaped, or otherwise unusual function names to
  `other`.
- Preserve unrelated dirty worktree edits.

## Plan

1. Replace category-only function-name normalization with exact safe-name
   normalization.
2. Keep duplicate and unknown attribution behavior from the hardening patch.
3. Update tests to prove exact safe names are retained and unsafe names are
   still collapsed.
4. Run focused Cloudflare egress tests and diff-aware verification.
5. Commit only the scoped diagnostic change and plan closeout.

## Verification

- `pnpm --dir apps/cloudflare test:node apps/cloudflare/test/runner-egress-intercept.test.ts`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/test/runner-egress-intercept.test.ts agent-docs/exec-plans/active/2026-05-21-openai-egress-function-names.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-05-21
Completed: 2026-05-21
