# Auto-manage Stripe webhook listener from `pnpm dev`

Status: completed
Created: 2026-04-21
Updated: 2026-04-21

## Goal

- Make `pnpm dev` transparently manage the Stripe CLI webhook listener so local
  hosted onboarding flows can complete subscription checkout without a second
  terminal and without copy-pasting per-developer `whsec_...` values across env
  stores.
- Keep the existing hosted local dev stack behavior intact when Stripe CLI is
  missing or explicitly opted out.

## Context

- Hosted onboarding checkout is subscription-only and the webhook route
  `apps/web/app/api/hosted-onboarding/stripe/webhook/route.ts` fails closed when
  `STRIPE_WEBHOOK_SECRET` is unset or when signature verification fails.
- `stripe listen --forward-to <url>` prints a `whsec_...` signing secret as the
  very first line of its startup output and continues streaming event logs
  while it runs. Stripe's documented contract is only that the caller uses
  "the secret from the initial output of the listen command." Running
  `stripe listen --print-secret` in a separate process is **not** guaranteed to
  return the same secret under account switching, `--api-key` overrides, or
  concurrent listeners, so this plan captures the secret from the live
  listener's stdout instead of relying on the `--print-secret` seam.
- Each developer has their own Stripe CLI login, so the secret is inherently
  per-developer. Sharing one value in Vercel Development env only works for one
  developer at a time and will silently break the other.
- `scripts/dev-hosted-local/stack.ts` already merges env from
  `repoEnv + pulledEnv + initialEnv`, then spawns `cloudflare` and (optionally)
  `web` children. That child-spawn site is where the new `stripe` child must
  join, and the merged env is where the captured secret must be injected
  before the `web` child process starts so Next.js sees it.

## Success criteria

- Running `pnpm dev` with Stripe CLI installed and logged in spawns a
  `stripe listen --forward-to http://<webHost>:<webPort>/api/hosted-onboarding/stripe/webhook`
  child process **before** the web child, captures the `whsec_...` line from
  the listener's startup stdout, and injects it into the web child's env so
  Next.js sees a verified signing secret.
- Orchestrator refuses to forward any `whsec_...` bytes to the console or to
  the existing prefixed stdout/stderr buffers. A dedicated redactor intercepts
  Stripe output, keeps the secret for env injection only, and replaces the
  secret substring with a fixed token (for example `[redacted whsec_...]`) in
  everything that reaches `pipeWithPrefix`, `stdoutText`, `stderrText`, and
  their tail helpers.
- Env precedence for `STRIPE_WEBHOOK_SECRET` is provenance-aware: only a value
  present in the current shell `initialEnv` or the repo-root `.env`
  (`repoEnv`) is preserved. A value that would only appear via pulled Vercel
  Dev env is ignored and overwritten by the captured secret, so a stale
  `whsec_placeholder` in Vercel Dev cannot silently outrank the local CLI
  login.
- When Stripe CLI is missing, the orchestrator prints a single actionable
  warning (`brew install stripe/stripe-cli/stripe`) from a `spawn` ENOENT path
  and continues without the listener or the secret injection, matching the
  existing optional-tool pattern used for Docker diagnostics. The rest of the
  stack still boots.
- `MURPH_DEV_SKIP_STRIPE_LISTEN=1` fully skips the listener child and the
  secret capture, mirroring the shape of `MURPH_DEV_SKIP_VERCEL_PULL`.
- `MURPH_DEV_SKIP_WEB=1` also skips the listener (there is no local web target
  to forward to), without warning noise about missing Stripe CLI.
- Listener lifecycle is distinct from `cloudflare`/`web`: the listener is
  required only during startup secret capture. If the listener child exits
  after the stack reports ready, the orchestrator logs a single degraded-mode
  warning and keeps the rest of the stack running. Stripe listener exit is
  therefore excluded from `waitForFirstChildExit`.
- Shutdown terminates the Stripe child with the existing
  `terminateChildProcessAndWait` path and does not leak the process on SIGINT.
- `pnpm typecheck` and the touched
  `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/stack.test.ts scripts/dev-hosted-local/config.test.ts`
  pass. Direct `tsx scripts/dev-hosted-local/main.ts --help` prints the new
  skip flag.

## Scope

- In scope:
  - `scripts/dev-hosted-local/stack.ts`: preflight, listener spawn before web,
    secret capture from listener startup stdout, env injection into web child,
    provenance-aware merge, shutdown wiring, exclusion from
    `waitForFirstChildExit`.
  - `scripts/dev-hosted-local/config.ts`: new `skipStripeListen` field parsed
    from `MURPH_DEV_SKIP_STRIPE_LISTEN`; help text entry.
  - `scripts/dev-hosted-local/types.ts`: extend `HostedLocalDevConfig` and the
    `NamedChildProcess`/`BufferedNamedChildProcess` name union to include
    `"stripe"`; extend the `HostedLocalDevStack.processes` shape to expose the
    optional listener child.
  - `scripts/dev-hosted-local/runtime.ts`: widen `spawnChildProcess` to accept
    `"stripe"`; add an optional per-spawn redactor seam that rewrites matched
    substrings (the captured `whsec_...`) before `pipeWithPrefix` and the
    stdout/stderr buffer appenders see them; add a small `captureStripeSecret`
    helper that waits for the first `whsec_...` match on the listener's
    stdout with a bounded timeout.
  - `scripts/dev-hosted-local/stack.test.ts`: switch from ordered
    `mockReturnValueOnce` to `mockImplementation((name) => ...)` keyed by the
    spawned child name so new `"stripe"` calls extend cleanly; cover
    listener-started + secret-captured + env-injected path, redaction of the
    secret in piped/buffered output, `initialEnv` / `repoEnv` preservation,
    `pulledEnv`-only value being overwritten, Stripe CLI missing (ENOENT)
    warn-and-skip, `MURPH_DEV_SKIP_STRIPE_LISTEN=1` honored, `MURPH_DEV_SKIP_WEB=1`
    skipping the listener, listener command shape, and listener post-ready
    exit not tearing down the stack.
  - `scripts/dev-hosted-local/config.test.ts`: cover `skipStripeListen` env flag
    parsing plus help text.
  - `apps/web/README.md`: short section describing auto listener, skip flag,
    and a note that shared `STRIPE_WEBHOOK_SECRET` in Vercel Development is
    incorrect for multi-dev teams.
  - `apps/web/.env.example`: annotate `STRIPE_WEBHOOK_SECRET` that `pnpm dev`
    auto-populates it from the local Stripe CLI login.
  - Repo-root `README.md` or the nearest durable dev-entrypoint doc: add
    Stripe CLI to the optional `pnpm dev` tool list so the dev contract stays
    discoverable outside `apps/web/README.md`.
  - `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`: this plan row.

- Out of scope:
  - Stripe product/price creation, test-mode data seeding, Stripe API clients.
  - Changing webhook verification, idempotency, or billing policy logic under
    `apps/web/src/lib/hosted-onboarding/**`.
  - Removing `STRIPE_WEBHOOK_SECRET` from any real environment store. The user
    will delete it from Vercel Development manually.
  - Any use of `stripe listen --print-secret` as a separate preflight process.
    The single-process capture above is the only supported seam.

## Constraints

- Must not change production runtime auth or billing invariants. The orchestrator
  is dev-only; the webhook route remains fail-closed.
- Must not inject a real or placeholder `whsec_...` when Stripe CLI is missing.
  An empty value is allowed; a synthetic placeholder is not (would pass
  `resolveHostedBillingReady` shape checks and confuse diagnostics later).
- Must not write webhook secret content to disk, stdout logs, or child-env
  echoes beyond what Stripe CLI itself prints.
- Must preserve the existing `MURPH_DEV_SKIP_VERCEL_PULL` / `MURPH_DEV_SKIP_WEB`
  ordering so `initialEnv` continues to override both pulled Vercel env and
  repo `.env`.
- Must be a low-risk repo-internal workflow/tooling change so verification stays
  on the routing doc's fast path (`pnpm typecheck` plus direct touched-file
  tests) rather than full acceptance.

## Tasks

1. [x] Add `skipStripeListen` to `HostedLocalDevConfig`, config parsing, and
       help text.
2. [x] Add `"stripe"` to the named-child unions in `types.ts` and widen
       `spawnChildProcess` in `runtime.ts`; thread the optional redactor hook
       through `pipeWithPrefix` and keep the output-buffer appenders behind a
       line-buffered redactor so secrets never hit the piped or buffered
       paths raw, even when `whsec_...` is split across chunk boundaries.
3. [x] Implement `spawnStripeListenerWithSecretCapture` that reads the
       listener's stdout, resolves on the first `/whsec_[A-Za-z0-9_]+/` match
       with a bounded timeout, terminates the child on pre-capture rejection,
       and installs the captured secret as the redactor for the live child
       before releasing the startup-buffered output.
4. [x] In `startHostedLocalDevStack`, resolve env provenance for
       `STRIPE_WEBHOOK_SECRET`: preserve only `initialEnv` or `repoEnv` hits;
       discard `pulledEnv`-only hits before deciding whether to capture from
       the listener. Also suppress the generic
       `warnForMissingEnv("STRIPE_WEBHOOK_SECRET")` when the listener will
       capture.
5. [x] Spawn the Stripe listener between env-merge and the web child so the
       captured secret can populate `runtimeEnv` before `web` starts; wire
       shutdown and exclude the listener from `waitForFirstChildExit`, with a
       post-ready exit handler that logs degraded-mode once without killing
       the stack.
6. [x] Extend tests in `stack.test.ts`, `config.test.ts`, and new
       `runtime.stripe.test.ts`, switching the `spawnChildProcess` mock to a
       name-keyed `mockImplementation` so later lanes extend cleanly.
       Regression tests cover split-boundary redaction and the timeout-kill
       path.
7. [x] Update `apps/web/README.md`, repo-root `README.md`, and
       `apps/web/.env.example`.
8. [x] Run `pnpm exec tsc --noEmit --project tsconfig.tools.json` plus the
       touched Vitest suite; capture evidence.
9. [x] `coverage-write` on `gpt-5.4-mini` is not required — the verification
       lane is low-risk repo-internal workflow/tooling fast path
       (`pnpm typecheck` + touched-file checks), which does not include
       package/app owner coverage per the routing doc.
10. [x] Run `simplify` audit subagent (Codex) + final `task-finish-review`
        audit subagent (Codex). Both returned; high/medium/low findings were
        addressed before close.
11. [x] Close plan and commit through `scripts/finish-task`.

## Verification

- `pnpm typecheck`
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/stack.test.ts scripts/dev-hosted-local/config.test.ts`
- `pnpm exec tsx --tsconfig tsconfig.base.json scripts/dev-hosted-local/main.ts --help`
  (readback check for the new flag entry)
- Direct scenario proof: run `pnpm dev` locally with the Stripe CLI installed
  and logged in, confirm that the `stripe` child starts, that the web child
  sees a non-empty `STRIPE_WEBHOOK_SECRET`, and that a Stripe test-mode
  `customer.subscription.created` event delivered through `stripe trigger`
  reaches `/api/hosted-onboarding/stripe/webhook` with signature verification
  green. Repeat with `MURPH_DEV_SKIP_STRIPE_LISTEN=1` to confirm the opt-out.
Completed: 2026-04-21
