# Hosted Stable Provider Cwd

## Goal

Make hosted Codex assistant turns present a stable provider-visible working directory across isolated Cloudflare runner invocations, without weakening the real restored vault/workspace isolation.

Success criteria:

- Hosted Linux runtime turns that are running from the restored vault root default provider `cwd` to a stable `/proc/self/cwd` string.
- Explicit assistant working directories remain honored.
- Local/non-hosted turns keep the existing vault-root fallback.
- Focused tests cover hosted, explicit, non-hosted, and non-vault-cwd cases.

## Constraints

- Preserve unrelated dirty working-tree edits.
- Do not expose raw local paths or provider prompts in logs, fixtures, docs, or commits.
- Keep the mitigation scoped to the assistant turn planning boundary unless inspection proves another path is necessary.

## State

- Done: Routed as a high-risk hosted runtime/trust-boundary change.
- Done: Patched shared turn planning to use stable `/proc/self/cwd` only for hosted Linux runtime processes restored at the vault cwd.
- Done: Added provider-plan diagnostics with metadata-only path fingerprints and no raw path logging.
- Done: Fixed notification turns to avoid injecting `input.vault` as an explicit working directory before shared planning.
- Done: Focused verification, root typecheck, coverage audit, security/privacy audit, and final review passed.
- Done: Scoped commit created without staging unrelated coordination-ledger rows.

## Working Set

- `packages/assistant-engine/src/assistant/turn-plan.ts`
- `packages/assistant-engine/src/assistant/notification-turn.ts`
- `packages/assistant-engine/src/assistant/provider-turn/attempt-observability.ts`
- `packages/assistant-engine/src/assistant/provider-turn-runner.ts`
- `packages/assistant-engine/test/**`

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-turn-plan.test.ts test/provider-registry-helpers.test.ts test/assistant-notification-turn-runtime.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/assistant-engine typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/turn-plan.ts packages/assistant-engine/src/assistant/notification-turn.ts packages/assistant-engine/src/assistant/provider-turn/attempt-observability.ts packages/assistant-engine/src/assistant/provider-turn-runner.ts packages/assistant-engine/test/assistant-turn-plan.test.ts packages/assistant-engine/test/provider-registry-helpers.test.ts packages/assistant-engine/test/assistant-notification-turn-runtime.test.ts`
- `pnpm typecheck`

## Audits

- `coverage-write`: no findings, no changes.
- `security-privacy-review`: no findings.
- `task-finish-review`: found notification-turn bypass; fixed.
- Post-fix `task-finish-review`: no findings.
