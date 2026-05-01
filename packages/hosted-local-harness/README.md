# `@murphai/hosted-local-harness`

This package is the repo-local control surface for reproducing the hosted Murph
Cloudflare application locally.

The long-term rule is simple:

> `pnpm dev`, hosted-local E2E suites, and one-off hosted debugging commands all
> go through the same harness profile, state file, environment planner, and
> cleanup path.

The package intentionally wraps the existing `scripts/dev-hosted-local/*` engine
instead of rewriting it. Those scripts already know how to stand up the local
Next.js control plane, Cloudflare worker/container plane, local runner bundle,
Postgres schema sync, Stripe listener, Vercel/OIDC context, and Docker cleanup.
This package makes that engine a productized local harness with stable profiles
and a CLI.

## Commands

From the repo root:

```bash
pnpm exec tsx --tsconfig tsconfig.base.json scripts/hosted-local.ts up --profile dev
pnpm exec tsx --tsconfig tsconfig.base.json scripts/hosted-local.ts e2e all --profile e2e:stub
pnpm exec tsx --tsconfig tsconfig.base.json scripts/hosted-local.ts e2e linq-webhook --profile e2e:stub
pnpm exec tsx --tsconfig tsconfig.base.json scripts/hosted-local.ts doctor --profile dev
```

`scripts/dev-hosted-local.ts` is now a compatibility wrapper for `up`, so the
existing root `pnpm dev` command keeps working while this package becomes the
canonical implementation boundary.

## Profiles

Profiles provide named defaults. Shell env still wins, so developers and CI can
override any value explicitly.

- `dev`: interactive hosted dev. Keeps the existing Vercel/Stripe/Codex bridge
  behaviour.
- `worker-only`: starts/reuses only the Cloudflare worker/container lane.
- `e2e:stub`: hermetic-ish hosted-local E2E defaults. It disables the local
  Codex bridge, skips Stripe listener startup, skips Vercel env pull, and forces
  assistant-provider stub mode.
- `e2e:live`: hosted-local E2E defaults for explicit live provider testing.

## State files

Each command writes a redacted state file under:

```text
.artifacts/hosted-local/<run-id>/state.json
```

The state file records the profile, command, selected hosted-local env knobs,
artifact directory, and service URLs once known. It is safe to upload in CI; any
key/token/password/JWK/database URL-shaped values, provider/user/contact
identifiers, payload-like env values, and sensitive command args are redacted.

## Migration plan encoded by this package

1. Existing commands keep working through compatibility wrappers.
2. New commands use `scripts/hosted-local.ts` directly.
3. Cloudflare package scripts can be collapsed to thin wrappers around
   `hosted-local e2e <scenario>`.
4. Hosted-local Vitest global setup can later read `MURPH_HOSTED_LOCAL_STATE_PATH`
   and reuse a suite-level stack instead of starting one stack per test file.

The important architectural cut is that test files should eventually express
scenarios only. The harness owns local infrastructure lifecycle.
