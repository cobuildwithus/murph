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

## Profiles

Profiles provide named defaults. Shell env still wins, so developers and CI can
override any value explicitly.

- `dev`: interactive hosted dev. Uses the production-shaped Cloudflare
  runner/container Codex app-server path with Vercel AI Gateway configuration.
- `worker-only`: starts/reuses only the Cloudflare worker/container lane.
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
   `HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL`) and must not own
   `MURPH_E2E_*` wiring or fake assistant directives.

The old `scripts/dev-hosted-local.ts` and
`apps/cloudflare/scripts/run-hosted-local-e2e.ts` files are compatibility
wrappers only.
