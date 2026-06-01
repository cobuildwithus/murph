# Hosted provider fetch hardening

Status: completed
Created: 2026-06-01
Updated: 2026-06-01

## Goal

- Add defense in depth so hosted runtime provider operations cannot silently
  bypass the injected Cloudflare provider fetch path and fall back to ambient
  process fetch.
- Thoroughly inspect the adjacent hosted provider paths for the same class of
  issue and cover any remaining risk with focused regressions.

## Success criteria

- Hosted Linq, Telegram, WhatsApp, and attachment provider paths fail closed or
  use the injected provider fetch when running in hosted runtime mode.
- Any intentionally local-only ambient fetch fallback remains outside hosted
  provider execution, documented by code shape and tests.
- Focused tests prove the guard and at least one realistic bypass attempt.
- Required typecheck, diff-aware tests, and completion audits pass.

## Scope

- In scope:
  - `packages/assistant-runtime` hosted provider fetch seams.
  - Provider-effect helpers used by hosted delivery, cleanup, attachments,
    channel activity, callbacks, and mailbox import.
  - Cloudflare's injected `providerFetch` authority wrapper for hosted runner
    egress.
  - Mechanical/static guard coverage if it can be kept narrow and durable.
- Out of scope:
  - Replacing Cloudflare egress interception.
  - Changing provider API behavior or credentials.
  - New scheduler, queue, retry, or provider abstraction layers.

## Constraints

- Preserve Worker-owned provider credential injection and runtime write-fence
  validation.
- Do not expose provider tokens, raw request payloads, or local paths in tests,
  logs, docs, or error messages.
- Keep the fix simple and owner-local. Prefer one small guard/helper over
  broad rewrites.

## Decisions

- Treat this as a trust-boundary hardening task because hosted provider egress
  must not silently downgrade to ambient process fetch.
- Keep lower operator-config provider clients' ambient fetch defaults intact for
  local/non-hosted usage; hosted runtime callers now pass explicit fetches or
  fail before reaching those local defaults.
- Bind Cloudflare `providerFetch` to the active runtime write-fence whenever a
  lease authority is present, and reject external provider egress when no active
  lease is available.
- Keep the architecture to two fetch primitives instead of introducing a
  provider-fetch framework:
  - `providerFetch` is for authority-bound provider API egress.
  - `publicInternetFetch` is for unauthenticated public attachment bytes and
    strips hosted runtime authority headers.
- Normalize nullable provider fetch dependencies through one small
  provider-agnostic helper; lower provider helpers require a concrete fetch and
  do not carry Linq-specific fetch boundary state.
- Limit Cloudflare hosted provider egress to the known provider hostnames that
  the runner egress boundary can authorize/intercept.

## Verification

- Passed:
  - Focused assistant-runtime hosted provider tests.
  - Focused Cloudflare runner/platform tests for provider-effect and provider
    fetch authority paths.
  - `pnpm typecheck`.
  - `pnpm test:diff <touched paths>`.
  - `git diff --check`.
  - Scoped diff privacy-pattern scan.

## Progress

- Started provider-fetch bypass sweep after the hosted-local reminder fix.
- Hardened hosted delivery callbacks, channel activity, provider effects,
  attachment downloads, message cleanup, and post-checkpoint cleanup to require
  explicit provider fetches at hosted boundaries.
- Collapsed repeated fetch guards into `requireHostedProviderFetchDependencies`
  and removed provider-specific fetch adapters; Linq uses the same normalized
  provider fetch shape as Telegram and WhatsApp.
- Split Linq attachment fetching so provider metadata uses `providerFetch`, while
  public CDN bytes use `publicInternetFetch`.
- Added Cloudflare provider host allowlisting and public fetch authority-header
  stripping.
- Added guard/regression tests for missing provider fetches, local-only ambient
  attachment fetch opt-in, public fetch header stripping, and Cloudflare
  provider fetch write-fence headers.
- Verification passed.
Completed: 2026-06-01
