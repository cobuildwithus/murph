# @murphai/cloudflare-hosted-control

Private Cloudflare-owned hosted control-plane seam shared by `apps/web` and `apps/cloudflare`.

This package exists so the public `@murphai/hosted-execution` package can stay
limited to shared dispatch transport while Cloudflare-specific operational
control routes remain private and owner-scoped.
