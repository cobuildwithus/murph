Goal (incl. success criteria):
- Make opt-in live OpenAI/Codex E2E runs default to a lower-cost model so a developer can run them without unexpectedly spending against a high-end model.
- Success means the real Codex app-server E2E and hosted-local live vault-persistence E2E use the lower-cost default while preserving explicit env overrides.

Constraints/Assumptions:
- Preserve unrelated dirty work in the checkout.
- Do not change production hosted deploy model requirements in this task.
- Use an already-priced and allowance-accepted model unless a separate pricing update is intentionally added.
- Do not print or persist provider credentials.

Key decisions:
- Use `gpt-5.4-mini` as the safe default because it is already present in hosted AI usage allowance pricing and deploy preflight allowlists.
- Keep `gpt-5.5` as the production deploy default unless the user explicitly asks to trade production quality for cost.

State:
- Plan registered; implementation in progress.

Done:
- Confirmed routine tests do not hit live OpenAI by default.
- Identified the opt-in live OpenAI/Codex E2E defaults.

Now:
- Patch live E2E defaults and docs.

Next:
- Run focused verification and close this plan.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-engine/test/assistant-codex-real-e2e.test.ts`
- `apps/cloudflare/test/hosted-local-vault-persistence-e2e.test.ts`
- `packages/hosted-local-harness/README.md`
- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/references/testing-ci-map.md`
