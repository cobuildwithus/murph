Goal (incl. success criteria):
- Make opt-in live OpenAI/Codex E2E runs default to `gpt-5.5` everywhere current repo guidance or runtime defaults choose a model.
- Success means the real Codex app-server E2E and hosted-local live vault-persistence E2E use `gpt-5.5` by default while preserving explicit env overrides.

Constraints/Assumptions:
- Preserve unrelated dirty work in the checkout.
- Do not change production hosted deploy model requirements in this task.
- Preserve allowance pricing for the current launch model.
- Do not print or persist provider credentials.

Key decisions:
- Use `gpt-5.5` as the only current hosted launch/live-test default. Do not route current ReviewGPT, live E2E, smoke, or deploy docs to older model choices.

State:
- Plan registered; implementation in progress.

Done:
- Confirmed routine tests do not hit live OpenAI by default.
- Identified the opt-in live OpenAI/Codex E2E defaults plus hosted deploy/smoke allowance docs that referenced older model choices.

Now:
- Patch live E2E defaults, hosted deploy/model allowance docs, and direct smoke defaults.

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
Status: completed
Updated: 2026-06-12
Completed: 2026-06-12
