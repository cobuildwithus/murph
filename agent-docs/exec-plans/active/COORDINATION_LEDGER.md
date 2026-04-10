# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex | Add a privacy-focused review-gpt prompt preset | `scripts/review-gpt.config.sh`, `scripts/chatgpt-review-presets/privacy.md`, `packages/cli/test/release-script-coverage-audit.test.ts` | `review_gpt_register_dir_preset` | in_progress | Narrow preset/config/test change only. |
| Codex | Refactor hosted runner env semantics into explicit typed runtime config | `apps/cloudflare/src/{node-runner.ts,runner-env.ts}`, `apps/cloudflare/test/{runner-env.test.ts,node-runner.test.ts}`, `packages/assistant-runtime/src/hosted-runtime/{models.ts,parsers.ts,environment.ts,context.ts,maintenance.ts,events.ts,execution.ts}`, `packages/assistant-runtime/src/hosted-runtime.ts`, `packages/assistant-runtime/test/hosted-runtime-*.test.ts`, `packages/device-syncd/src/{config.ts,index.ts}`, `ARCHITECTURE.md` | `buildHostedRunnerResolvedConfig`, `HostedAssistantRuntimeResolvedConfig`, `runHostedDeviceSyncPass`, `prepareHostedDispatchContext` | in_progress | Cross-package runtime boundary refactor; avoid overlapping edits in listed files while this lane is active. |
