# @murphai/cloudflare-hosted-control

Private Cloudflare-owned hosted execution-plane seam shared by `apps/web` and
`apps/cloudflare`.

This package exists so `@murphai/hosted-execution` can stay limited to shared
runtime contracts while Cloudflare-owned control routes remain private and
owner-scoped.

The greenfield control concept is runner nudge/status, not hosted run
acquire/commit/finalize. The package surface is limited to browser-vault
session creation plus runner nudge/status, and the runner contracts
intentionally do not expose `runId`, committed sequence, target sequence, or
web-owned turn adoption state.
