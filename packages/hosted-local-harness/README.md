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
pnpm hosted-local e2e linq-delivery temporal-orchestration --no-bundle
pnpm hosted-local e2e linq-scheduled-reminder
pnpm hosted-local e2e codex-gateway-prefix --profile e2e:live
pnpm hosted-local e2e vault-persistence --profile e2e:live
pnpm hosted-local e2e --list
pnpm hosted-local profiles
pnpm hosted-local doctor
pnpm hosted-local run -- pnpm --dir apps/cloudflare test:workers
```

Root `pnpm dev` is a thin alias for `pnpm hosted-local up`.

## External Temporal worker package

Hosted-local keeps Web and Cloudflare in this checkout, but it can start the
Temporal worker and its idempotent schedule setup from one sibling or absolute
package directory:

```bash
MURPH_DEV_TEMPORAL_WORKER_PACKAGE_DIR=../murph-cloud/packages/hosted-orchestrator-temporal \
  pnpm dev
```

The setting changes only the package directory passed to `pnpm --dir` for
`temporal:worker` and `temporal:ensure-device-sync-reconciler-schedule`. The
Temporal address, namespace, task queue, and signed Web/Cloudflare HTTP
contracts remain unchanged. The private package is not mirrored into public
Murph: when the setting is unset or blank, hosted-local fails before starting
Temporal and points to this variable or `MURPH_DEV_TEMPORAL=disabled`. This
keeps one canonical local entrypoint without a submodule, source mirror, or
second orchestration path.

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
  reads `auth.json` from `MURPH_HOSTED_LOCAL_CODEX_HOME` (default `~/.codex`),
  refreshes it host-side when the access token is near expiry, and seeds only
  the short-lived access/id tokens into the runner's isolated Codex home via
  the dev-only `HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON` env (honored only when
  `NODE_ENV=development`); the durable refresh token never leaves the host.
  `OPENAI_API_KEY` is still required for the image generation tool. Sign in
  once with `CODEX_HOME=~/.codex codex login`. A single dev session that
  outlives the seeded access token (~10 days) will see Codex turns fail with an
  auth error; restart `pnpm dev` to reseed fresh tokens.
- `worker-only`: starts/reuses only the Cloudflare worker/container lane.
  Uses the same ChatGPT-subscription Codex auth seeding as `dev`.
- `e2e:stub`: deterministic hosted-local E2E defaults. It runs the real Codex
  app-server binary against the production Worker, production RunnerContainer,
  production UserRunner fence lifecycle, and production provider-egress boundary.
  External vendors are replaced with deterministic local stubs: the model path
  uses a test-only `HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL` override with
  a fake provider key, so zero provider spend. The profile skips Stripe listener
  startup and Vercel env pull. It also disables live Linq webhook tunnel registration
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
3. Hosted E2E fakes external vendors only. The default CI path must use the
   production Murph hosted topology: `apps/cloudflare/src/index.ts`, production
   `RunnerContainer`, production `UserRunnerDurableObject`, production runtime
   provider fetch, production provider egress, real runner bundle, and real
   Codex app-server. Scenarios that need fault injection must set the scenario
   metadata `testControls: true`; that is the only supported path to the
   hosted-local test Worker entrypoint and test RPCs.
4. E2E scenario names live in `src/e2e.ts`; scripts pass one or more scenario
   names to the harness instead of hard-coding Vitest files. A multi-scenario
   invocation runs one prepared suite and preserves declared isolation.
5. Diagnostic E2E scenarios that can intentionally fail while investigating
   provider behavior are opt-in by explicit scenario name and are excluded from
   `pnpm hosted-local e2e`.
6. Programmatic users call `startHostedLocalHarness(...)` or declared
   `@murphai/hosted-local-harness/*` package exports, not root scripts or
   package `src/` paths directly.
7. Every run writes a redacted state file under
   `.artifacts/hosted-local/<run-id>/state.json`.
8. Hosted-local E2E always runs the real Codex app-server binary; the only
   model substitute is the local scripted Responses API stub owned by the
   `apps/cloudflare` test helpers. Production runtime packages accept only
   neutral, `NODE_ENV=test`-gated overrides
   (`MURPH_HOSTED_CODEX_APP_SERVER_COMMAND`,
   `HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL`) plus the
   `NODE_ENV=development`-gated `HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON`
   subscription auth seed, and must not own `MURPH_E2E_*` wiring or fake
   assistant directives.
9. `HOSTED_APP_SESSION_HMAC_KEY` is web-only authority. Canonical CLI,
   programmatic, worktree, doctor, run, and E2E boundaries remove inherited
   copies before resolving profiles or starting helpers. Only the web child may
   receive the key, from the loaded web environment or the deterministic local
   fallback; Cloudflare, Temporal, database, and preparatory children never do.

Use `pnpm hosted-local` as the single hosted-local entrypoint.

## Live hosted Stripe billing browser matrix

`stripe-billing-browser-matrix` is the explicit hosted-local lane for
production-shaped billing proof. It runs locally on demand and on every trusted
same-repository pull request. It reuses the canonical full-stack
scenario lifecycle, a real local PostgreSQL database, the harness-owned
`stripe listen` child, Murph's website and Settings UI, Stripe-hosted Checkout,
Invoice, and Customer Portal pages, real Stripe test-mode APIs and webhooks, and
the existing test-only app-session issuer. It does not add a production route,
auth bypass, alternate server, or mocked Stripe SDK.

Stripe forbids automating its hosted payment frontends. The browser therefore
drives every Murph action and proves the real Checkout, Invoice, and Portal
surface, but never fills or submits a provider-protected final control. A pinned
official Stripe CLI fixture confirms the exact Checkout Session; Stripe's test
API pays the exact observed Invoice or applies the Portal-equivalent plan
mutation. Real webhooks still return through the harness-owned listener and the
browser must observe the reconciled Settings result. See Stripe's
[automated-testing boundary](https://docs.stripe.com/automated-testing) and
[CLI fixture guide](https://docs.stripe.com/stripe-cli/fixtures).

Install the pinned, checksum-verified Stripe CLI and run the lane from the repo
root:

```bash
pnpm stripe:cli:setup
pnpm hosted-billing:live:preflight
pnpm hosted-local e2e stripe-billing-browser-matrix
pnpm hosted-billing:live:cleanup
```

The preflight, matrix, and cleanup commands require these names to be supplied
by an operator-local shell or the dedicated GitHub Environment; values are not
stored in the repository:

```text
MURPH_HOSTED_STRIPE_BILLING_LIVE=1
MURPH_HOSTED_STRIPE_BILLING_SECRET_KEY
MURPH_HOSTED_STRIPE_BILLING_ACCOUNT_ID
MURPH_HOSTED_STRIPE_BILLING_RUN_ID
NEXT_PUBLIC_PRIVY_APP_ID
HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY
HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY
HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY
HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_EDGE_SEAT_MONTHLY
HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MAX_SEAT_MONTHLY
HOSTED_ONBOARDING_STRIPE_PLAN_CHANGE_PORTAL_CONFIGURATION_ID_LAUNCH_EDGE_MONTHLY
```

The matrix additionally accepts `DATABASE_URL` as the local PostgreSQL base
when the caller needs to select it explicitly.

Use a dedicated Stripe sandbox account only. The four prices and Portal
configuration are stable, pre-provisioned non-secret IDs. The configured Portal
configuration is the sandbox default. Preflight rejects live-mode authority,
the wrong sandbox account, malformed IDs, inactive or mispriced catalog
entries, and a Portal configuration that is not the active default with plan
updates enabled and immediate invoicing. The browser journey remains the
authoritative proof that the provider actually exposes the dedicated Pulse and
Edge products.
The test-mode secret remains in the single Vitest coordinator; the web process
receives only `STRIPE_SECRET_KEY`, the harness-owned Stripe CLI child receives
only `STRIPE_API_KEY`, and browser/Cloudflare/Temporal/setup children receive
neither. The CLI key is passed through its child environment, never a command
argument. The matrix sets `MURPH_HOSTED_LOCAL_E2E_STRIPE_LISTENER=1` to claim
the one isolated listener explicitly; other E2E scenarios still fail closed
unless `MURPH_DEV_SKIP_STRIPE_LISTEN=1`.

The matrix covers Starter activation followed by paid Pulse Checkout, paid
Pulse to Edge through Customer Portal, Edge to Pulse as a renewal Subscription
Schedule, Family Checkout with contactless web invite activation, and paid
individual-to-Family conversion as an in-place update of the existing
subscription. The named Family Checkout case starts from an authenticated
lapsed individual with no active subscription so the browser exercises the
real Family Checkout owner.

All created or adopted resources carry an opaque run correlation. Normal
teardown verifies exact run metadata before expiring Sessions, releasing
Schedules, canceling Subscriptions, deleting Customers, or detaching
PaymentMethods. The standalone cleanup command can recover an interrupted
Checkout by matching the opaque correlation already present in Murph-owned
metadata, tags linked resources with exact run ownership, and then applies the
same refusal checks. It never mutates or deletes shared products, prices, or
unrelated sandbox objects. Polling is bounded against typed Stripe and Murph
state; fixed sleeps are not accepted as correctness proof.

Checkout completion uses Stripe's official fixture boundary. Paid plan changes
use the supported Subscription Update and Schedule APIs, and webhook delivery
travels through the harness-owned listener. The provider contract is pinned to
Stripe's official documentation for
[Checkout](https://docs.stripe.com/payments/checkout),
[Subscription Update](https://docs.stripe.com/api/subscriptions/update),
[subscription schedules](https://docs.stripe.com/billing/subscriptions/subscription-schedules),
[Portal deep links](https://docs.stripe.com/customer-management/portal-deep-links),
[webhooks](https://docs.stripe.com/webhooks), and
[test-mode values](https://docs.stripe.com/testing).

Stripe retains immutable provider history such as paid invoices, events, and
terminal subscription records. The lane bounds that residue to the nine named
scenarios in one dedicated sandbox run and removes every mutable owned resource;
it does not claim to erase Stripe's audit history. No repository secret or
variable value is configured in source. Trusted pull requests fail closed unless
the dedicated `hosted-stripe-billing-sandbox` GitHub Environment contract is
fully provisioned; forks and dependency-bot heads retain only hermetic proof.
