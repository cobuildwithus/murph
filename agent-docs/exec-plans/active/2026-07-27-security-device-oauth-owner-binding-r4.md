# Bind hosted device OAuth callbacks to the initiating Murph member

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Prevent a transferable wearable-provider authorization URL from binding one
  person's provider credentials and health data to another Murph member.
- Preserve the existing same-browser Oura, WHOOP, Strava, and Junction-backed
  connection flow through the shared device-sync ingress owner.

## Success criteria

- The hosted provider callback requires an active first-party Murph app session
  before OAuth state consumption or provider token exchange.
- Hosted Web always supplies that session member as `expectedOwnerId`.
- A different member and an unauthenticated browser fail before provider
  exchange, connection persistence, wake delivery, backfill, or canonical
  import.
- Owner mismatch leaves the valid one-time OAuth state available to the
  initiating member, while successful completion and replay retain their
  current behavior.
- Local/tunneled `device-syncd` callers keep their explicit non-hosted callback
  contract; no second OAuth state, cookie, queue, or lifecycle owner is added.
- Focused route, shared-ingress, and persistence proof plus canonical
  verification, preliminary specialists, final ReviewGPT, and PR CI pass.

## Scope

- In scope:
  - `apps/web` hosted device callback authentication and owner propagation.
  - The hosted public-ingress service signature if needed to make owner
    omission impossible at that boundary.
  - Focused route and state/connection regressions and current device-sync
    security documentation.
- Out of scope:
  - Provider token, refresh, webhook, importer, projection, or scheduler
    redesign.
  - A new callback state table, flow cookie, session system, or cross-device
    handoff.
  - Changes to local daemon callback behavior unless required to keep its
    existing explicit contract compiling.

## Evidence

- The authenticated start route stores the current member as OAuth-state owner
  and returns a provider authorization URL carrying the random state.
- The public hosted callback does not read the current app session and calls
  the owner-optional hosted service without `expectedOwnerId`.
- The hosted service normalizes the omission to `null`, so shared ingress
  consumes the state without an owner check.
- Shared ingress then exchanges the provider code and persists the resulting
  external account and encrypted credential under the owner stored in the
  transferable state.
- Connection-established wake and runtime backfill follow that stored owner,
  ultimately importing the provider's wearable data into that member's
  canonical vault.
- The shared ingress already rejects a supplied owner mismatch before state
  consumption, and its focused test proves the initiating member can still
  complete afterward.
- `docs/device-sync-hosted-control-plane.md` already states that the callback
  consumes OAuth state only for the same member; current hosted code violates
  that invariant.
- The accepted ReviewGPT patch is limited to the hosted route/service and
  focused route, wake, owner-mismatch, and replay tests. Its downloaded
  SHA-256 matched the response, both applicability checks passed, and parent
  inspection found no remaining ownerless hosted callback call site.

## Risks and mitigations

1. Risk: provider redirects lose the first-party session and legitimate
   connections stop completing.
   Mitigation: the start flow is same-browser, the app session cookie is
   path-wide and SameSite Lax, and focused route proof covers the authenticated
   callback. Any future cross-device flow needs an explicit member-bound
   handoff instead of restoring state-only ownership.
2. Risk: authentication failure burns a valid provider state.
   Mitigation: require the app session before invoking shared ingress; owner
   mismatch is already checked before state consumption.
3. Risk: a broad shared API change breaks local/tunneled daemon callbacks.
   Mitigation: make owner mandatory only at the hosted service/route boundary
   unless a narrower shared type correction is demonstrably needed.

## Tasks

1. [x] Obtain one deletion-first ReviewGPT patch for the accepted Round 4
   finding.
2. [x] Inspect every patch hunk and reduce it to the existing app-session and
   `expectedOwnerId` owners.
3. Add route-level failing proof for anonymous and wrong-member callbacks plus
   successful initiating-member completion and preserved state.
4. Reconcile current security/device-sync docs and tests without introducing a
   parallel callback protocol.
5. Run focused proof, typechecks, canonical diff verification, acceptance,
   preliminary specialists, parent review, final ReviewGPT, and exact-head CI.
6. Commit, push, and leave one separate draft PR unmerged.

## Verification

- Required:
  - focused hosted callback route and shared public-ingress tests
- focused Postgres-backed OAuth-state/connection proof where the existing
  testkit can exercise the boundary without live provider credentials
- affected package typechecks
- `pnpm test:diff packages/device-syncd apps/web`
- `pnpm verify:acceptance`
- preliminary completion-specialists and final exact-head ReviewGPT/CI
- Completed so far:
  - shared public-ingress regression: 65 tests passed
  - `@murphai/device-syncd` typecheck passed
