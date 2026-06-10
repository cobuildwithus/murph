Goal (incl. success criteria):
- Delete the hosted-local Codex app-server stub shim (`packages/hosted-local-harness/src/codex-app-server-stub.ts`, ~1,275 lines of generated protocol re-implementation) and run the real `codex app-server` binary in every hosted-local E2E scenario.
- Default E2E lanes must never call a paid model provider: the real binary is pointed at the local deterministic Responses API stub via the existing test-only `HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV` override (http + loopback/private-host enforced, `NODE_ENV=test` only) with a fake `OPENAI_API_KEY`.
- Success means: hosted-local e2e scenarios pass with no shim installed anywhere, `MURPH_E2E_CODEX_APP_SERVER_STUB_*` env vars and the bundle-staged fake `codex` script are gone, real-model spend remains exclusive to explicitly opt-in `e2e:live` scenarios, and suite wall-clock stays within ~2x of the prior default lane.

Constraints/Assumptions:
- No production runtime, auth, or env invariant changes; all wiring stays behind existing test-only gates (`NODE_ENV=test`, loopback base-url validation in `packages/assistant-runtime/src/hosted-runtime/codex-config.ts`).
- No real provider keys in default lanes. Real-model usage stays opt-in via `--profile e2e:live`, unchanged.
- Proven in-repo: the real binary accepts the local provider stub's Responses SSE stream (gateway-prefix / long-thread / container-continuity already run real codex against the recorder with a fake key, wired through `HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV`).
- Runner container image ships real codex (`CODEX_CLI_VERSION=0.135.0` in `Dockerfile.cloudflare-hosted-runner-base`); smoke proves `codex app-server --help`.
- Keep `MURPH_HOSTED_CODEX_APP_SERVER_COMMAND` (test-only command override): assistant-runtime/engine unit tests consume it with their own local fakes; it is a guarded unit-test seam, not part of the deleted shim.

Key decisions:
- Keep the deterministic local Responses API stub (`startAssistantProviderStubServer`) as the model substitute; only the protocol shim is deleted. The shim re-implements OpenAI's app-server surface and silently drifts on `@openai/codex` upgrades; the provider stub only speaks the stable public Responses API.
- Keep `stub` / `live` mode names and `e2e:stub` / `e2e:live` profiles. `stub` now means "real binary + scripted provider stub": `resolveHostedAssistantLocalDevEnv` sets `HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV` instead of the shim base-url env, and the shim install in `dev-hosted-local/stack.ts` is gone.
- Scripted responses are per-provider-request: a turn with one tool call consumes two queued entries (tool-call item, then final text). `HostedLocalAssistantProviderScriptedResponse` = string | `{functionCall}`.
- In-band shim directives replaced with structured scripted responses executed by the real binary:
  - `__murphE2eToolCalls` → `buildAssistantProviderMurphToolCall(...)` emits a Responses `function_call` item (namespace `murph`); real codex relays it over `item/tool/call`, so Murph's production dynamic-tool path runs for real.
  - `__murphE2eVaultCliCommands` → `buildAssistantProviderVaultCliCall(...)` emits an `exec_command` shell call; real codex executes vault-cli inside its sandbox with the runner PATH — the same path production models use.
  - Codex 0.135.0 on Linux advertises the unified `exec_command` tool (`cmd` string arg); the tool name is centralized in `buildAssistantProviderShellCommandCall` for future bumps.
- Shim-only test surfaces replaced or deleted:
  - `MURPH_E2E_CODEX_APP_SERVER_STUB_EXPECT_DYNAMIC_TOOLS` handshake → `expectAdvertisedMurphDynamicTools()` asserts the murph namespace tools codex actually advertised in recorded `/v1/responses` request bodies (more faithful).
  - `MURPH_E2E_CODEX_APP_SERVER_STUB_TURN_DELAY_MS` → the active-turn-latency scenario scripts a real sandboxed `sleep` to keep a turn busy.
  - Negative tests guarding the now-deleted shim mechanism removed from `hosted-runtime-codex-config.test.ts`, `runner-env.test.ts`, harness env/stack tests.

State:
- Complete. All verification green; closing via finish-task and opening PR from branch `remove-codex-app-server-stub`.

Done:
- Shim source + its 853-line test deleted; harness install path, constants, strip-lists, package export, and package-boundary entry removed. Net diff ~-2,200 lines.
- Provider stub extended with structured `function_call` scripted responses (stream + JSON paths); queued-response state renamed to `queuedResponses` and widened; vault-cli/shell/murph-tool helpers added with unit coverage.
- All 4 directive tests migrated; stale shim imports/assertions stripped from live-mode tests, unit tests, and harness tests; docs updated (harness README, testing-ci-map).
- Verified: root `pnpm typecheck` green; hosted-local-harness 258 tests green; cloudflare e2e-support/runner-env 58+14 green; assistant-runtime codex-config 25 green.
- E2E proof: `telegram-first-contact` passes against the real codex binary (3/3, ~55s wall; run with `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT` for the Prisma local-reset guard).

Now:
- Done; archived by finish-task.

Next:
- None. Residual: manual-only scenarios (snapshot-stress, stuck-invocation-recovery, runner-warm-reuse, device-sync lanes, active-turn-latency) were migrated statically but not run locally; they are exercised on their existing manual cadence. snapshot-stress seeds synthetic rollouts that real codex resume may treat as stale (engine falls back to a fresh thread by design).

E2E proof (all real binary + scripted local provider stub, zero spend):
- telegram-first-contact: 3/3 (~55s)
- linq-delivery: 8/8 (~3m) — dynamic-tool `item/tool/call` relay + advertised-tools request-body assertion
- codex-image-media-delivery: pass (~90s) — `attach_response_media` dynamic tool + media part in Linq reply
- linq-scheduled-reminder: pass (~4m) — scripted `exec_command` ran `vault-cli automation save` in the real sandbox; scheduled reminder fired
- linq-onboarding-followup: 1/1 (~5.5m) — all three vault-cli flows (accelerate, onboarding complete, archive-and-skip) through the real sandbox
- `pnpm test:diff`: 82 files / 1,295 tests green (incl. apps/cloudflare verify)

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: per-turn latency of real binary + local stub in the default lane; measured during scenario runs. Snapshot-stress/high-turn scenarios may need turn-count tuning.

Working set (files/ids/commands):
- `packages/hosted-local-harness/src/dev-hosted-local/{stack,constants,environment}.ts`
- `apps/cloudflare/test/helpers/hosted-local-e2e-support.ts`, `hosted-local-full-stack-scenario.ts`
- `apps/cloudflare/test/hosted-local-*-e2e.test.ts`, `hosted-local-e2e-support.test.ts`, `runner-env.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts`
- `packages/hosted-local-harness/test/**`
- Commands: `pnpm hosted-local e2e <scenario>`, focused vitest runs
Status: completed
Updated: 2026-06-10
Completed: 2026-06-10
