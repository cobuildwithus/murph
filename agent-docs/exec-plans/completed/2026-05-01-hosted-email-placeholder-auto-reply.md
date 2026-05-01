# Hosted Email Placeholder Auto-Reply Boundary

## Goal

Prevent hosted email auto-reply from sending provider-visible replies when the staged assistant input has only generic placeholder prompt text.

Success criteria:

- Hosted email mailbox import still creates a durable `AssistantInputEvent` even when raw EML or body projection is unavailable.
- Prompt-ready email input contains safe minimized sender/recipient summary, subject, bounded preview/body text, hostedmail reply target, and attachment descriptors when available.
- Placeholder-only hosted email input is observable by admission/Codex state but auto-reply writes durable suppression evidence with reason `email.body_unavailable`.
- No staging gate is reintroduced on raw EML or inbox projection success.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- `packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts`
- `packages/hosted-execution/src/{contracts,builders,parsers,email-ingress}.ts`
- `apps/cloudflare/src/hosted-email/worker-ingress.ts`
- `apps/web/app/api/internal/hosted-mailbox/email-ingress/route.ts`
- `packages/assistant-engine/src/assistant/automation/reply.ts`
- `packages/assistant-engine/src/assistant/input-store.ts`
- `packages/assistant-engine/test/assistant-automation-runtime.test.ts`

## Constraints

- Preserve the mailbox plus workspace-checkpoint protocol.
- Do not expose raw email, provider payloads, secrets, or direct personal identifiers in logs, fixtures, docs, or prompts.
- Keep reply-target authority on the existing `hostedmail:` target.
- Do not make inbox projection success the gate for assistant input staging.

## Verification Plan

- Focused assistant-runtime hosted mailbox import tests.
- Focused hosted email ingress tests.
- Focused assistant-engine auto-reply runtime tests.
- `pnpm typecheck`.
- Truthful scoped or diff verification for touched package files.
- Required security/privacy, coverage-write, and final-review passes.

## Status

Focused verified; implementation complete. Scoped commit is blocked by overlapping active dirty work in shared hosted-runtime and assistant-engine files, so this plan is being archived without committing.

Verification:

- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir packages/hosted-execution test -- hosted-execution-builders-hosted-email.test.ts hosted-email-ingress.test.ts hosted-email-dispatch.test.ts`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-mailbox-conversation-import.test.ts`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-automation-runtime.test.ts -t "hosted email"`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/hosted-email-worker-ingress.test.ts --no-coverage`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-email-mailbox-ingress-route.test.ts --no-coverage`
- `pnpm --dir apps/web typecheck`
- `git diff --check`

Known unrelated verifier blocker:

- `bash scripts/workspace-verify.sh test:diff ...` reaches affected package typechecks/tests, then fails in `packages/cli/test/release-script-coverage-audit.test.ts` because `agent-docs/exec-plans/active/2026-05-01-hosted-webhook-vercel-workflow.md` has no matching ledger row and because unrelated workflow route `.js` sidecars exist under `apps/web/app/.well-known/workflow/**`.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
