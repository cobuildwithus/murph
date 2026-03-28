# `@murph/hosted-execution`

Shared hosted-execution helpers for the hosted `apps/web` control plane and the
Cloudflare execution worker.

## Scope

- own the hosted execution dispatch/status/control contract types
- define hosted execution auth header names and HMAC helpers
- normalize the shared hosted execution env variables
- build stable internal route paths for dispatch and user control calls
- provide typed fetch clients for signed dispatch and bearer-authenticated
  control-plane requests

## Contract

- the signed dispatch envelope stays timestamped and HMAC-authenticated
- the control-plane path layout stays shared between callers and the worker
- env naming stays canonical so hosted web and Cloudflare do not drift
- this package owns the hosted-execution transport seam; app-local wrappers
  should stay thin
