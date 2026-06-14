Goal (incl. success criteria):
- Make `pnpm dev` (hosted-local dev/debug profiles) run hosted Codex model turns on a locally logged-in ChatGPT/Codex subscription instead of `OPENAI_API_KEY`, so interactive dev stops billing the API key for assistant turns.
- Seed the runner from a host Codex home (`MURPH_HOSTED_LOCAL_CODEX_HOME`, default `~/.codex-7`) at stack startup; keep `OPENAI_API_KEY` flowing unchanged for the image-generation tool and the Worker egress credential injection.
- Success means: dev-profile hosted-local runs write a ChatGPT-mode `auth.json` into the runner's isolated `.codex-hosted` home and emit a builtin-`openai`-provider `config.toml`; e2e profiles, the test base-URL override lane, and production runner config are byte-identical to today.

Constraints/Assumptions:
- Dev-only, double-gated: the harness seeds the new env var only for non-test hosted-local profiles, and the runner honors it only when `NODE_ENV=development` (mirrors the existing `NODE_ENV=test` gate for `HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL`).
- Never log, commit, or echo token material; auth.json content travels via the existing JSON-escaped wrangler env file (0600) and is deleted from runner env after the file write.
- Codex app-server ignores env API keys for model auth (`enable_codex_api_key_env=false`); auth mode is decided solely by `auth.json` (`auth_mode: "chatgpt"`), so keeping `OPENAI_API_KEY` in runner env for image-gen cannot hijack model calls (verified against codex-rs at the pinned 0.135.0 surface).
- ChatGPT-mode Codex must not get a configured `base_url`; the builtin `openai` provider routes subscription auth to the ChatGPT backend itself. `chatgpt.com` / `auth.openai.com` egress rides the existing open-internet passthrough in the runner egress intercept.
- Codex rotates refresh tokens on refresh and persists them to its `CODEX_HOME`; a refresh inside the ephemeral runner would orphan the rotated token. Mitigation: the harness refreshes host-side at startup when the access token is within the freshness window and persists rotated tokens back to the host Codex home, so in-container refreshes require a multi-day uninterrupted dev session.

Key decisions:
- Auth JSON travels as one new forwarded env var (`HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON`) through the existing launch-spec assistant profile, not a new file channel or mount.
- Subscription-mode `config.toml` uses the builtin `openai` provider (no custom `[model_providers]` section, no `env_key`, no `base_url`); effective model provider id env becomes `openai` so turn-time target resolution matches.
- Harness-side token freshness: refresh via `auth.openai.com/oauth/token` (codex public client id) when access-token exp is within 96h, persist back to the host home with codex's auth.json schema; fail fast with a `codex login` remediation message when refresh fails or auth.json is not ChatGPT-mode.
- The new env name is added to the runner-secret disallow list so member-supplied runner secrets cannot set it.

State:
- Implementation, tests, and all required completion audits done in worktree `murph-dev-codex-subscription` (branch `hosted-local-dev-codex-subscription`).

Done:
- Deep read of harness env assembly, launch-spec forwarding, hosted codex-config, egress intercept, and codex-rs auth internals.
- Harness seeding module: ChatGPT-mode validation, host-side refresh near expiry (mkdir advisory lock + re-read-after-lock so concurrent stacks rotate the shared refresh token once; 30s fetch timeout; rotated tokens persisted to the host home 0600), minimal base64url-encoded seed (access/id tokens + account id, empty refresh token; durable refresh token never leaves the host).
- Stack wiring via `shouldSeedHostedLocalCodexSubscriptionAuth` (non-test profile AND `NODE_ENV !== test`); inherited shell values always stripped; seed scoped to the worker env only.
- Runtime subscription mode in `prepareHostedCodexRuntimeEnvironment` (base64url decode + fail-closed validation, auth.json write 0600, stale auth.json removal on non-subscription wakes, builtin-`openai`-provider config.toml, env stripping, `NODE_ENV=development` gate).
- Worker policy: forwarded-env profile entry, runner-secret denylist entry, worker-contracts env declaration, egress passthrough pin tests, AUTH_JSON redaction coverage.
- Audits: security-privacy-review (1 medium accepted+fixed: seed minimization), coverage-write (env-file round-trip, --var/config exclusion, redaction tests), deep-review (2 mediums accepted+fixed: base64url env-file encoding; refresh lock), task-finish-review (3 lows accepted+fixed: lock acquire timeout, inherited-value strip, gate helper extraction + tests).
- Verification green at every round: root `pnpm typecheck`, `pnpm test:diff` (1365+ tests), focused suites across the three owners.

Now:
- Final `pnpm typecheck` + `pnpm test:diff` after the last review fixes, then finish-task and PR.

Next:
- Open PR; live `pnpm dev` scenario check (Codex turn on chatgpt backend, image-gen on API key) remains a human follow-up.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/hosted-local-harness/src/dev-hosted-local/codex-subscription-auth.ts` (new)
- `packages/hosted-local-harness/src/dev-hosted-local/stack.ts`
- `packages/hosted-local-harness/src/dev-hosted-local/constants.ts`
- `packages/assistant-runtime/src/hosted-runtime/launch-spec.ts`
- `packages/assistant-runtime/src/hosted-runtime/codex-config.ts`
- `apps/cloudflare/src/hosted-env-policy.ts`
- matching tests under `packages/hosted-local-harness/test`, `packages/assistant-runtime/test`, `apps/cloudflare/test`
Status: completed
Updated: 2026-06-11
Completed: 2026-06-11
