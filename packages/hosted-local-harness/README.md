# `@murphai/hosted-local-harness`

Single local surface for reproducing the hosted Murph Cloudflare application.
It owns profile selection, redacted run state, runner bundle preparation,
hosted E2E scenario selection, diagnostics, and cleanup.

## Commands

From the repo root:

```bash
pnpm hosted-local up
pnpm hosted-local e2e
pnpm hosted-local e2e checkpoint-baseline --no-bundle
pnpm hosted-local e2e linq-webhook
pnpm hosted-local e2e linq-scheduled-reminder
pnpm hosted-local e2e codex-gateway-prefix --profile e2e:live
pnpm hosted-local e2e vault-persistence --profile e2e:live
pnpm hosted-local e2e --list
pnpm hosted-local profiles
pnpm hosted-local doctor
pnpm hosted-local run -- pnpm --dir apps/cloudflare test:workers
```

Root `pnpm dev` is a thin alias for `pnpm hosted-local up`.

## Local web origin

The hosted web app binds to `http://127.0.0.1:3000` by default. Telegram's
Login Widget treats `localhost` and `127.0.0.1` as different origins, and
BotFather accepts the loopback IP as the local domain, so the harness uses the
IP form for generated onboarding URLs, callback origins, and local status
output. Browsers may still reach the same listener through `localhost:3000`
when their resolver maps `localhost` to loopback, but use
`http://127.0.0.1:3000` for Telegram sign-in tests. Set
`MURPH_DEV_WEB_HOST=localhost` only when debugging non-Telegram local web
behavior that explicitly needs the hostname.

## Workers AI in local dev

The generated local wrangler config carries the production `ai` binding so
hosted transcription (`@cf/openai/whisper-large-v3-turbo`) runs against real
Workers AI in `pnpm dev`. Wrangler proxies that binding through a remote dev
session, which has two consequences:

- The dev machine needs Cloudflare auth that can open a remote dev session:
  `wrangler login` (OAuth). The Cloudflare dev wrapper strips
  `CLOUDFLARE_API_TOKEN` from the final `wrangler dev` process when this
  binding is active because wrangler prefers that variable over OAuth and
  account-scoped tokens cannot open the remote session.
- Transcription calls incur (tiny) real Workers AI usage. Dev voice audio is
  health-adjacent, so the account-level rule that Workers AI request/response
  logging and AI Gateway capture stay disabled (`agent-docs/SECURITY.md`)
  covers `pnpm dev` transcription traffic too.

Set `MURPH_DEV_SKIP_WORKERS_AI=1` to drop the binding and start the stack
without Cloudflare auth; hosted transcription then fails closed at use time.
The hosted-local test-routes profile (E2E scenarios) never carries the
binding — the test entrypoint composes a deterministic fake
(`apps/cloudflare/src/hosted-local-test/`), so no automated check calls live
Workers AI.

When the binding is active, the Cloudflare dev wrapper strips
`CLOUDFLARE_API_TOKEN` from the final `wrangler dev` process so OAuth is used
for the remote session; token auth is intentionally unsupported for this child
process. The token still reaches every preparatory tool that needs it.

## Profiles

Profiles provide named defaults. Shell env still wins, so developers and CI can
override any value explicitly.

- `dev`: interactive hosted dev. Uses the production-shaped Cloudflare
  runner/container Codex app-server path. Codex model turns run on a local
  ChatGPT-subscription Codex login instead of `OPENAI_API_KEY`: the harness
  reads `auth.json` from `MURPH_HOSTED_LOCAL_CODEX_HOME` (default `~/.codex-7`),
  refreshes it host-side when the access token is near expiry, and seeds only
  the short-lived access/id tokens into the runner's isolated Codex home via
  the dev-only `HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON` env (honored only when
  `NODE_ENV=development`); the durable refresh token never leaves the host.
  `OPENAI_API_KEY` is still required for the image generation tool. Sign in
  once with `CODEX_HOME=~/.codex-7 codex login`. A single dev session that
  outlives the seeded access token (~10 days) will see Codex turns fail with an
  auth error; restart `pnpm dev` to reseed fresh tokens.
- `worker-only`: starts/reuses only the Cloudflare worker/container lane.
  Uses the same ChatGPT-subscription Codex auth seeding as `dev`.
- `e2e:stub`: deterministic hosted-local E2E defaults. It runs the real Codex
  app-server binary against a local scripted Responses API stub (test-only
  `HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL` override with a fake provider
  key, so zero provider spend), skips Stripe listener startup, and skips
  Vercel env pull. It also disables live Linq webhook tunnel registration
  unless a caller explicitly opts back in.
- `e2e:live`: hosted-local E2E defaults for explicit live provider testing.
  Opt-in live Codex scenarios default to `gpt-5.5` unless
  `MURPH_HOSTED_LOCAL_LIVE_E2E_MODEL` is set.

`runner:docker:base` is cache-aware: it skips the native runner base-image build
when the local image already carries the current Dockerfile fingerprint label. On
cold CI hosts it first tries the GHCR-published fingerprinted base image, then
falls back to a local build. Use
`pnpm --dir apps/cloudflare runner:docker:base -- --force` to force a rebuild.
Pull-request CI does not authenticate to GHCR before running PR-controlled code,
so the GHCR runner base package must be public for anonymous cache pulls there.

## State files

Each command writes a redacted state file under:

```text
.artifacts/hosted-local/<run-id>/state.json
```

The state file records the profile, command, selected hosted-local env knobs,
artifact directory, and service URLs once known. It is safe to upload in CI; any
key/token/password/JWK/database URL-shaped values, provider/user/contact
identifiers, payload-like env values, and sensitive command args are redacted.

## Design rules

1. Root `pnpm hosted-local ...` is the canonical developer and CI entrypoint.
2. `apps/*/package.json` may expose broad aliases, but not one-off hosted-local
   scenario scripts.
3. E2E scenario names live in `src/e2e.ts`; scripts pass scenario names to the
   harness instead of hard-coding Vitest files.
4. Diagnostic E2E scenarios that can intentionally fail while investigating
   provider behavior are opt-in by explicit scenario name and are excluded from
   `pnpm hosted-local e2e`.
5. Programmatic users call `startHostedLocalHarness(...)` or declared
   `@murphai/hosted-local-harness/*` package exports, not root scripts or
   package `src/` paths directly.
6. Every run writes a redacted state file under
   `.artifacts/hosted-local/<run-id>/state.json`.
7. Hosted-local E2E always runs the real Codex app-server binary; the only
   model substitute is the local scripted Responses API stub owned by the
   `apps/cloudflare` test helpers. Production runtime packages accept only
   neutral, `NODE_ENV=test`-gated overrides
   (`MURPH_HOSTED_CODEX_APP_SERVER_COMMAND`,
   `HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL`) plus the
   `NODE_ENV=development`-gated `HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON`
   subscription auth seed, and must not own `MURPH_E2E_*` wiring or fake
   assistant directives.

The old `scripts/dev-hosted-local.ts` and
`apps/cloudflare/scripts/run-hosted-local-e2e.ts` files are compatibility
wrappers only.
