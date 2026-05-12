# Hosted Runner Compatibility Hard Cut

## Goal

Delete legacy hosted-runner compatibility surfaces so callback-only runtime
transport and write-fence validation are the single long-term authority model.

Success criteria:

- Runtime/container job input no longer accepts or forwards per-invocation
  proxy-token or local-internal-proxy fields.
- Worker local-internal-proxy route and proxy-token authorization helpers are
  removed.
- Active-invocation compatibility RPCs and write-fence fallback validation are
  removed.
- No-op idle/deferred checkpoint APIs are removed from `RunnerStateStore`.
- Warm-only `invokeIdleCheckpointIfWarm` compatibility RPC is removed.
- Cloudflare hosted-runner tests and docs match the hard-cut architecture.

## Constraints

- Preserve unrelated dirty work in the current checkout.
- Do not weaken runtime callback write-fence validation.
- Do not add new persisted state or deployment requirements.

## Plan

1. Remove proxy-token/local-internal-proxy fields and route handling.
2. Remove active-invocation compatibility methods and tests.
3. Remove no-op checkpoint APIs and warm-only idle checkpoint RPC.
4. Update docs/tests to callback-only/write-fence-only architecture.
5. Run focused Cloudflare verification and final audits.

## Verification

Planned:

- `pnpm --dir apps/cloudflare verify`
- `pnpm typecheck` if the app verify surface does not provide a sufficient
  signal for cross-package contract fallout.
