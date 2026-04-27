# `@murphai/hosted-execution`

Shared hosted-execution helpers for the hosted `apps/web` control plane and the
Cloudflare execution worker.

## Scope

- own shared hosted execution contract types for the greenfield mailbox,
  workspace checkpoint, redacted runtime log, and runner nudge/status seams
- define hosted execution auth header names and request-canonicalization helpers
- normalize the shared hosted execution env variables that are deployment-vendor neutral
- build stable internal route paths for hosted runtime mailbox, workspace,
  logging, status, and transport helpers
- temporarily keep the legacy `HostedIngressEvent` / `HostedRun` /
  `HostedExecutionCursor` contracts only until the hard-cut migration deletes
  their call sites
- provide typed shared control helpers while keeping deployed auth adapters
  app-local

## Contract

- signed callback canonicalization stays timestamped and request-bound across app-local signers and verifiers
- the shared control/status path layout stays stable between callers and the worker
- vendor-neutral env naming stays canonical so hosted web and Cloudflare do not drift
- this package owns only the shared hosted-execution transport seam: mailbox,
  workspace checkpoint, runtime log/status codecs, route builders, auth header
  names, and canonicalization helpers
- deployment topology stays app-local: shared packages must not own worker hostnames, callback base-url defaults, or proxy-vs-server inference
- app-local auth adapters still own deployment-specific bearer token acquisition plus callback signing and verification
- operator-facing hosted public-origin fallback and Cloudflare callback-key config stay app-local and are intentionally documented in `apps/web/README.md`, not here
- Cloudflare operational control routes are private owner APIs, not part of this public package
- device-sync runtime snapshot/apply/token contracts stay on
  `@murphai/device-syncd/hosted-runtime`; this package only carries the outer
  hosted runtime control seam plus the shared device-sync wake-hint shape needed
  by that seam
- new hosted runtime log contracts are structured and redacted: they accept
  event codes and allowlisted scalar metadata, not free-form messages or
  plaintext payload fields

## Migration note

This package now hard-cuts device-sync runtime snapshot/apply/token exports.
Consumers that previously imported those symbols from `@murphai/hosted-execution` or `@murphai/hosted-execution/parsers` must import them from `@murphai/device-syncd/hosted-runtime` instead.
