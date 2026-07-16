Goal (incl. success criteria):
- Restore hosted Telegram welcome and foreground replies when local hosted execution uses ChatGPT subscription auth.
- Success means the generated `hosted-chatgpt-openai` provider id passes the shared Codex provider validation boundary and remains backed by the prewritten hosted Codex config.

Constraints/Assumptions:
- Preserve ChatGPT subscription auth and the existing generated provider transport configuration.
- Preserve API-key, local-test, and other registered provider behavior.
- Do not add queues, retries, fallback providers, persisted state, or schema changes.
- Keep runtime diagnostics secret-safe.

Key decisions:
- Define the internal hosted ChatGPT provider id once in operator config, which owns provider validation.
- Reuse that shared constant when the hosted runtime writes Codex configuration.
- Cover both session option validation and provider override resolution so the exact pre-Codex failure boundary cannot regress.

State:
- Completed.

Done:
- Proved Telegram ingress, mailbox persistence, Temporal signaling, and workspace staging were healthy.
- Proved assistant execution failed before Codex startup because `hosted-chatgpt-openai` was absent from the shared reserved-provider set.
- Registered the internal provider id at the shared operator-config validation boundary and reused that owner constant in hosted runtime Codex config generation.
- Added focused regression coverage for session serialization, provider override resolution, and hosted runtime target normalization.
- Passed focused package tests, affected package typechecks, and the required coverage-write audit.
- Ran diff-aware verification; all affected suites passed except an unchanged assistant-engine timeout under concurrent load whose initiating test passed in isolation.
- Restarted the preserved local stack on the patched commit and proved the queued Telegram wake resumed, assistant execution completed, and Telegram accepted outbound delivery with HTTP 200.

Now:
- None.

Next:
- Push the task branch, open the PR, and complete the required ReviewGPT and CI gates.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/operator-config/src/assistant/target-runtime.ts
- packages/operator-config/test/assistant-provider-config-normalization.test.ts
- packages/assistant-runtime/src/hosted-runtime/codex-config.ts
- packages/assistant-runtime/test/hosted-runtime-codex-local-provider-target.test.ts
- packages/assistant-engine/test/codex-provider-overrides.test.ts
- pnpm test:diff
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
