# `@murphai/hosted-execution`

Shared hosted-execution helpers for the hosted `apps/web` control plane and the
Cloudflare execution worker.

## Scope

- own shared hosted execution contract types for the greenfield mailbox,
  workspace checkpoint, redacted runtime log, hosted usage record, and Temporal
  processing/status seams
- define the shared hosted `conversation.message` payload shapes for supported
  hosted conversation channels: Linq, Telegram, email, and WhatsApp
- define hosted execution auth header names and request-canonicalization helpers
- normalize the shared hosted execution env variables that are deployment-vendor neutral
- build stable internal route paths for hosted runtime mailbox, workspace,
  logging, status, and transport helpers
- provide typed shared control helpers while keeping deployed auth adapters
  app-local

## Active public path

New hosted runtime code should import mailbox, workspace checkpoint, runtime log,
and workspace invocation contracts from
`@murphai/hosted-execution/runtime-control`. Temporal processing/status
contracts live in `@murphai/hosted-execution/orchestration-control`. Use
`@murphai/hosted-execution/routes` for stable route constants and builders.
Use `@murphai/hosted-execution/assistant-usage` for the hosted assistant usage
record contract, parser, id helper, and credential-source helper.
Use `@murphai/hosted-execution/plan-usage` for the strict empty request and
member plan-usage status codec.
Use `@murphai/hosted-execution/clinical-records` for the pointer-only clinical
sync wake, bounded run/page/outcome contracts, and stable signed runtime route
paths. Those contracts carry hashes, opaque cursors, sanitized FHIR page JSON,
and bounded counts; they never carry OAuth credentials or raw provider URLs in
mailbox or Temporal state.

Legacy generic hosted run/cursor/drain contracts and parsers are not part of the
active package surface. The bounded clinical retrieval descriptor and opaque
page cursor on the explicit clinical-records subpath are a separate active
domain contract. Historical completed plans and migration notes may still
mention the deleted generic state.

## Contract

- signed callback canonicalization stays timestamped and request-bound across app-local signers and verifiers
- the shared control/status path layout stays stable between callers and the worker
- vendor-neutral env naming stays canonical so hosted web and Cloudflare do not drift
- this package owns only the shared hosted-execution transport seam: mailbox,
  workspace checkpoint, runtime log/status codecs, hosted usage record codecs,
  plan-usage request/status codecs, route builders, auth header names, and
  canonicalization helpers; projection logic stays in `apps/web`
- deployment topology stays app-local: shared packages must not own worker hostnames, callback base-url defaults, or proxy-vs-server inference
- app-local auth adapters still own deployment-specific bearer token acquisition plus callback signing and verification
- operator-facing hosted public-origin fallback and Cloudflare callback-key config stay app-local and are intentionally documented in `apps/web/README.md`, not here
- Cloudflare operational control routes are private owner APIs, not part of this public package
- normal webhook and app paths append durable mailbox facts and signal Temporal only;
  they do not send user-level runner nudges directly to Cloudflare
- Temporal calls Cloudflare `ensure-processing`; Cloudflare returns
  `runtime_processing_accepted` or `retry_later` and owns runner start, wake,
  active-fence alarm cleanup, and execution cleanup.
- device-sync runtime snapshot/apply/token contracts stay on
  `@murphai/device-syncd/hosted-runtime`; this package only carries the outer
  hosted runtime control seam plus the shared device-sync wake-hint shape needed
  by that seam
- new hosted runtime log contracts are structured and redacted: they accept
  event codes and allowlisted scalar metadata, not free-form messages or
  plaintext payload fields
- runtime-control parsers may keep explicit fail-closed guards for removed
  run/status fields, but those guards must reject the old fields rather than
  reading, translating, or otherwise supporting them as compatibility input

## Ownership note

This package now hard-cuts device-sync runtime snapshot/apply/token exports.
Consumers that previously imported those symbols from `@murphai/hosted-execution` or `@murphai/hosted-execution/parsers` must import them from `@murphai/device-syncd/hosted-runtime` instead.
