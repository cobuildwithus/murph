# @murphai/cloudflare-hosted-control

Private Cloudflare-owned hosted execution-plane seam shared by `apps/web` and `apps/cloudflare`.

This package exists so the public `@murphai/hosted-execution` package can stay
limited to shared dispatch transport while the Cloudflare-owned execution status
routes remain private and owner-scoped.
