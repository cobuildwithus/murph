# `@murphai/hosted-execution`

Shared hosted-execution helpers for the hosted `apps/web` control plane and the
Cloudflare execution worker.

## Scope

- own the hosted execution dispatch/status/control contract types
- define hosted execution auth header names and HMAC helpers
- normalize the shared hosted execution env variables that are deployment-vendor neutral
- build stable internal route paths for dispatch and user control calls
- own the shared dispatch contracts, signed callback routes, immutable outbox payload envelopes, and staged dispatch-payload ref helpers
- provide typed fetch helpers for signed dispatch requests and generic bearer-authenticated
  server control-plane requests, including dispatch-payload stage/dispatch/delete helpers

## Contract

- the signed dispatch envelope stays timestamped and HMAC-authenticated
- the control-plane path layout stays shared between callers and the worker
- vendor-neutral env naming stays canonical so hosted web and Cloudflare do not drift
- this package owns shared hosted-execution contracts, codecs, route builders, and auth helpers
- deployment topology stays app-local: shared packages must not own worker hostnames, callback base-url defaults, or proxy-vs-server inference
- app-local auth adapters still own deployment-specific bearer token acquisition and verification
