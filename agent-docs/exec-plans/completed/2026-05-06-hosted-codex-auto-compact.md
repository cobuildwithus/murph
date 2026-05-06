Goal (incl. success criteria):
- Set hosted Codex runtime config to auto-compact comfortably below GPT-5.5 long-context pricing thresholds and disable disposable prompt-history writes.
- Success: generated hosted Codex config includes `model_auto_compact_token_limit = 220000` and `[history] persistence = "none"`, focused tests cover the TOML output, and no secrets/personal identifiers are introduced.

Constraints/Assumptions:
- Preserve unrelated dirty work in the shared checkout.
- Hosted Codex skill instructions must remain disabled for prompt-cache stability.
- Use the existing hosted Codex config writer rather than adding a new config surface unless code inspection proves that insufficient.

Key decisions:
- Use a fixed hosted default of 220000 tokens based on the prior Codex default inspection and discussion.
- Configure `[history] persistence = "none"` in the isolated hosted Codex config instead of forwarding a runtime env knob.

State:
- Ready for closeout.

Done:
- Located hosted Codex config writer and existing config tests.
- Added hosted auto-compact and history-persistence config defaults.
- Added focused assertions for both generated TOML settings.
- Confirmed in sibling Codex source that `model_auto_compact_token_limit` triggers automatic compaction and `[history] persistence = "none"` skips history writes.
- Verification passed: `pnpm --dir packages/assistant-runtime test -- hosted-runtime-codex-config`, `pnpm typecheck`, and `pnpm --dir packages/assistant-runtime test:coverage`.
- Security/privacy and coverage-write audit passes found no required changes.

Now:
- Close out safely with a scoped commit.

Next:
- None after closeout.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/codex-config.ts`
- `packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-05-06-hosted-codex-auto-compact.md`
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
