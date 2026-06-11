# Companion app sign-in-token and status endpoints

Status: completed
Created: 2026-06-11
Updated: 2026-06-11

## Goal

- Ship the two backend endpoints for the iOS companion app MVP
  (`agent-docs/product-specs/companion-app-mvp.md` "Backend Work"):
  `POST /api/device-sync/companion/sign-in-token` and
  `GET /api/device-sync/companion/status` in `apps/web`, with a small
  `createSignInToken` addition to the device-syncd Junction client and a
  reused canonical account-ensure path so SDK-flow webhooks are never
  orphan-delayed.

## Success criteria

- Sign-in-token route verifies the caller through the existing Privy
  server-side identity verification (bearer token, no new auth model),
  resolves the member's Junction user with the exact existing
  `buildJunctionClientUserId` convention, ensures an active junction
  `device_connection` through the existing `upsertConnection` path used by
  the Junction Link callback (idempotent: prior Link members resolve to the
  same account, never a duplicate), calls Junction
  `POST /v2/user/{user_id}/sign_in_token`, and responds exactly
  `{ "signInToken": string, "environment": "sandbox" | "production" }`.
- The sign-in token is never logged or persisted; a test proves route
  logging never receives the token.
- Status route returns backend-confirmed evidence only from existing read
  models: `{ lastDataReceivedAt, resources: { <resource>: { lastReceivedAt } } }`
  with no health values.
- Route-level tests cover auth rejection, happy path with a mocked
  control plane, token redaction, and idempotent account-ensure
  (second call resolves the same account).
- `pnpm test:diff` (scoped to touched paths) and typecheck are green;
  `security-privacy-review`, `coverage-write`, and `task-finish-review`
  audits run before handoff.

## Scope

- In scope: `packages/device-syncd` (junction client `createSignInToken`,
  SDK connection-ensure seam, public-ingress method + exports),
  `apps/web` companion routes + bearer Privy auth helper + status reader,
  spec doc note deferring `companion_installations`, durable doc deltas
  (ARCHITECTURE/SECURITY trust-boundary notes), tests.
- Out of scope: the iOS app itself, `companion_installations` schema,
  new rate-limiting infrastructure, per-resource persisted receipt state,
  connect-page copy changes.

## Constraints

- Technical constraints: workspace boundary rules (apps/web imports
  device-syncd only via declared exports); no new persisted state; reuse
  `upsertConnection` externalRef/blind-index idempotency discipline; junction
  env/key-prefix validation is the sandbox/prod separation authority.
- Product/process constraints: high-risk task class (auth + public routes +
  external egress) => plan + ledger row, security-privacy-review mandatory,
  finish with `scripts/finish-task`, PR without merge.

## Risks and mitigations

1. Risk: SDK-flow account ensure could duplicate or clobber an existing
   Junction Link connection.
   Mitigation: derive the same deterministic `client_user_id`, resolve the
   same Junction user, and persist through the same `upsertConnection`
   keyed on (provider, externalAccountId blind index) with ownership
   conflict guard; test second-call idempotency.
2. Risk: token leakage through logs or error details.
   Mitigation: never log the token, response-only handoff, redaction test
   asserting logger calls never receive the token string.
3. Risk: webhooks for SDK members orphan-delayed.
   Mitigation: ensure runs before token mint; account status is `active`
   via the canonical path the webhook resolver (`getConnectionByExternalAccount`)
   reads.

## Tasks

1. device-syncd: add `JunctionClient.createSignInToken`, SDK
   connection-ensure handler on the junction provider, public-ingress
   `createSdkSignInSession`, and the webhook resource-name helper export.
2. apps/web: bearer Privy auth helper reusing existing verification;
   control-plane passthrough; companion sign-in-token + status routes;
   status reader over existing read models.
3. Update spec doc (defer installations record) and durable docs.
4. Tests in device-syncd and apps/web per success criteria.
5. Verification + required audits + finish-task + PR.

## Decisions

- The bearer token is the Privy identity token (the token the repo's
  existing `verifyHostedPrivyIdentityToken` path verifies); no parallel
  access-token verification path is introduced, and there is intentionally
  no cookie fallback (CSRF-immune bearer-only surface).
- `companion_installations` is deferred: the request body is validated and
  discarded (simplicity; no operational need yet). Spec updated in the same
  change.
- No rate-limiting added: the repo has no rate-limiting pattern for
  authenticated routes today; noted in the PR body instead of inventing
  infrastructure.
- Both companion routes enforce the hosted launch-consent gate (the status
  consent gate was added from an accepted deep-review finding).
- Status evidence: lastDataReceivedAt and per-resource receipts derive from
  durable `webhook_hint` signals (data events only); availability keys are
  normalized through the shared junction resource-name mapping so one
  resource never splits into alias twins.

## Verification

- `pnpm test:diff` full lane green (device-syncd owner + reverse dependents,
  apps/web verify incl. next build, lint, dev-smoke).
- Focused reruns after review-driven fixes: device-syncd typecheck + full
  package tests (633), apps/web typecheck + eslint + companion route tests
  (16), settings device-sync suites.
- Audits: security-privacy-review clean; simplify 4 low findings accepted and
  landed; coverage-write proofs added; deep-review 1 finding accepted and
  landed; task-finish-review 1 medium accepted and landed.
Completed: 2026-06-11
