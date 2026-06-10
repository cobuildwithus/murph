Goal (incl. success criteria):
- Remove the highest-value remaining Codex protocol mock: the happy-path app-server JSON-RPC fakes inside `packages/assistant-engine/test/assistant-codex-runtime.test.ts` (MockChildProcess re-implementing turn streaming, warm reuse, steering).
- Replace them with a default-on package-level lane that runs the REAL `codex app-server` binary against a local scripted Responses API stub (zero provider spend, deterministic) — the proven PR #103 pattern, now at unit/package level so `@openai/codex` upgrades break package CI immediately instead of only hosted-e2e lanes.
- Success: new real-binary test file runs by default in the assistant-engine test lane (no env gate, no API key), covers single-turn streaming, warm reuse, steering, and dynamic-tool relay against the real protocol; redundant MockChildProcess happy-path tests are deleted; all fault-injection/lifecycle fakes are kept (the real binary cannot emit malformed/stale/untagged events on demand).

Constraints/Assumptions:
- Dependency change is high-risk per AGENTS.md: add `@openai/codex` as an exact-pinned devDependency of assistant-engine matching `CODEX_CLI_VERSION=0.135.0` in Dockerfile.cloudflare-hosted-runner-base; update the committed lockfile in the same change; public registry; installs fine with --ignore-scripts (the runner image already proves this).
- No production code changes expected; this is test-surface work plus the devDependency.
- The opt-in real-model lane (`assistant-codex-real-e2e.test.ts`, MURPH_RUN_REAL_CODEX_E2E=1) keeps its distinct purpose (real model + cache probes) and stays.
- CI package lanes (release package coverage assistant-engine on ubuntu, CLI host matrix macos/ubuntu) get the binary via the devDependency; `node_modules/.bin/codex` is the spawn target.
- Per-turn latency with real binary + local stub is ~1-2s; a handful of real-protocol tests keeps the lane fast.

Key decisions:
- Build a compact engine-local scripted Responses stub (queued string | {functionCall} entries, SSE shapes proven in PR #103: function_call items with call_id/arguments-string/optional namespace; exec_command for shell) rather than importing apps/cloudflare test helpers (package boundary rules).
- Reuse the existing real-e2e harness shape: isolated temp CODEX_HOME + generated config.toml with a custom `[model_providers.local-stub]` whose base_url points at the in-test HTTP stub and env_key is a fake key; wire_api = "responses", retries 0.
- Delete MockChildProcess tests only where the new real lane truthfully subsumes the assertion (happy-path turn execution/streaming, warm reuse happy paths, steering happy path); keep every adversarial test (poisoning, stale events, malformed output, exit-without-completion, env-change invalidation, RPC frame-shape assertions).

State:
- Implementation in progress in worktree `murph-codex-unit-real` (branch `codex-unit-real-app-server`).

Done:
- Added `@openai/codex@0.135.0` exact-pinned devDependency (lockfile updated; `node_modules/.bin/codex` resolves, app-server mode verified).
- New default-on lane `assistant-codex-scripted-runtime.test.ts`: 4 tests against the REAL binary + in-file scripted Responses stub — turn streaming, thread resume via `resumeSessionId` (same threadId across turns), murph dynamic-tool relay over real `item/tool/call` (progressDelivery received the scripted update), and live `turn/steer` mid-request (steer must fire shortly after onLiveTurn; synchronous steer races turn registration on the real server). 4/4 in ~6s.
- Deleted the subsumed MockChildProcess happy-path steer test ('keeps one Codex app-server process open and steers late input into the active turn'); its unique release-callback assertion moved into the real steer test.
- Scope honesty note: most remaining MockChildProcess tests assert murph-SIDE behavior (request frames sent, env sanitization policy, spawn/reuse lifecycle, poisoning) and are NOT protocol re-implementations — they stay. Further pruning can follow as the real lane grows assertions.
- Full assistant-engine test lane green: 105 files / 1,214 tests including the new lane.

Now:
- `pnpm test:diff` running; then finish-task and PR.

Next:
- None after PR.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether warm-reuse observation needs a runtime-state reader vs process-id assertion; resolved during implementation.
- UNCONFIRMED: @openai/codex package install size impact on CI cold installs; measured at install.

Working set (files/ids/commands):
- `packages/assistant-engine/package.json`, `pnpm-lock.yaml` (devDependency)
- `packages/assistant-engine/test/assistant-codex-scripted-runtime.test.ts` (new)
- `packages/assistant-engine/test/assistant-codex-runtime.test.ts` (delete subsumed happy-path tests)
- Reference: `packages/assistant-engine/test/assistant-codex-real-e2e.test.ts`, `apps/cloudflare/test/helpers/hosted-local-e2e-support.ts` (stub shapes)
- Commands: `pnpm --dir packages/assistant-engine test`, `pnpm typecheck`, `pnpm test:diff`
Status: completed
Updated: 2026-06-10
Completed: 2026-06-10
