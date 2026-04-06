# `@murphai/hosted-execution`

Shared hosted-execution helpers for the hosted `apps/web` control plane and the
Cloudflare execution worker.

## Scope

- own the hosted execution dispatch/status/control contract types
- define hosted execution auth header names and HMAC helpers
- define the shared worker callback hosts and default callback base URLs, including the single runner results seam
- normalize the shared hosted execution env variables
- build stable internal route paths for dispatch and user control calls
- own the canonical dispatch lifecycle, immutable outbox payload envelopes, and staged dispatch-payload ref helpers
- provide typed fetch clients for signed dispatch requests and OIDC bearer-authenticated
  control-plane requests, including dispatch-payload stage/dispatch/delete helpers

## Contract

- the signed dispatch envelope stays timestamped and HMAC-authenticated
- the control-plane path layout stays shared between callers and the worker
- callback hostnames and callback-base-url defaults stay shared across runtime callers, with commit/email/side-effect callbacks collapsed onto one results host
- env naming stays canonical so hosted web and Cloudflare do not drift
- this package owns the hosted-execution transport seam; app-local wrappers
  should stay thin
