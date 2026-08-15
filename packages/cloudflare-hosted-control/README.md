# @murphai/cloudflare-hosted-control

Private Cloudflare-owned hosted execution-plane seam shared by `apps/web` and
`apps/cloudflare`.

This package exists so `@murphai/hosted-execution` can stay limited to shared
runtime contracts while Cloudflare-owned control routes remain private and
owner-scoped.

The greenfield control concept is signed Temporal processing/status, not hosted
run acquire/commit/finalize or web-to-Cloudflare runner nudges. The package
surface is limited to browser-vault session creation plus processing/status, and
the runner contracts intentionally do not expose `runId`, committed sequence,
target sequence, or web-owned turn adoption state.

Normal webhook and app paths append durable mailbox facts in web-owned storage and
signal Temporal only. Temporal calls Cloudflare `ensure-processing`; Cloudflare
returns `runtime_processing_accepted` or `retry_later` and owns runner start,
wake, active-fence alarm cleanup, and execution cleanup.

Device webhook Queue messages are encrypted, non-canonical burst transport.
They contain no plaintext provider or member identity outside the secure box.
Web/Postgres trace claims, dirty state, and connection lifecycle fences remain
the sole canonical admission authority.
