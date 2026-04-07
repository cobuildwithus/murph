# `@murphai/hosted-execution`

Shared hosted-execution helpers for the hosted `apps/web` control plane and the
Cloudflare execution worker.

## Scope

- own the shared hosted execution dispatch and status contract types
- define hosted execution auth header names and HMAC helpers
- normalize the shared hosted execution env variables that are deployment-vendor neutral
- build stable internal route paths for dispatch and runner side-effect calls
- own the shared dispatch contracts, signed callback routes, immutable outbox payload envelopes, and staged dispatch-payload ref helpers
- provide the typed dispatch transport client used by hosted web to enqueue work into Cloudflare

## Contract

- the signed dispatch envelope stays timestamped and HMAC-authenticated
- the shared dispatch/status path layout stays stable between callers and the worker
- vendor-neutral env naming stays canonical so hosted web and Cloudflare do not drift
- this package owns only the shared hosted-execution transport seam: dispatch/status codecs, route builders, outbox payload helpers, and auth helpers
- deployment topology stays app-local: shared packages must not own worker hostnames, callback base-url defaults, or proxy-vs-server inference
- app-local auth adapters still own deployment-specific bearer token acquisition and verification
- Cloudflare operational control routes are private owner APIs, not part of this public package
- hosted device-sync runtime snapshot/apply/connect-link contracts live under `@murphai/device-syncd/hosted-runtime`
