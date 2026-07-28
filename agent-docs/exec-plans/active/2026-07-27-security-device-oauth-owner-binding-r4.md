# Bind hosted device OAuth callbacks to the initiating Murph member

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Prevent a transferable wearable-provider authorization URL from binding one
  person's provider credentials and health data to another Murph member.
- Preserve the existing same-browser Oura, WHOOP, Strava, and Junction-backed
  connection flow through the shared device-sync ingress owner.
- Make the same-browser contract deployable by requiring the provider callback
  URL to use the same hostname as the first-party hosted app-session boundary.

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
- Every hosted browser OAuth start rejects a configured callback hostname that
  differs from the hostname serving the authenticated start request, before
  OAuth state creation, shared-ingress construction, or provider authorization.
- Hosted Web build validation plus Cloudflare preview and production
  preflight reject the same split-host configuration shape.
- Local/tunneled `device-syncd` callers keep their explicit non-hosted callback
  contract; no Domain cookie, second OAuth state or callback cookie, queue,
  handoff, or lifecycle owner is added.
- Focused route, shared-ingress, start-boundary, Web-build, deployment, and
  persistence proof plus canonical verification, preliminary specialists,
  final ReviewGPT, and PR CI pass.

## Scope

- In scope:
  - `apps/web` hosted device callback authentication and owner propagation.
  - The hosted public-ingress service signature needed to make owner omission
    impossible at that boundary.
  - Hosted browser start-time callback-host validation before OAuth side
    effects.
  - Hosted Web build validation and Cloudflare preview/production deploy
    preflight for the same-host invariant.
  - Focused route, state/connection, start-boundary, and deploy-preflight
    regressions.
  - Current operator, security, hosted-control-plane, active-plan, and PR-intent
    documentation.
- Out of scope:
  - Provider token, refresh, webhook, importer, projection, or scheduler
    redesign.
  - A new callback state table, Domain cookie, flow cookie, session system, or
    cross-device handoff.
  - Changes to local or tunneled daemon callback behavior beyond documenting
    that its existing explicit contract is unchanged.

## Evidence

- The authenticated start route stores the current member as OAuth-state owner
  and returns a provider authorization URL carrying the random state.
- Before this PR, the public hosted callback did not read the current app
  session and called the owner-optional hosted service without
  `expectedOwnerId`.
- The hosted service normalized that omission to `null`, so shared ingress
  consumed the state without an owner check, exchanged the provider code, and
  persisted the resulting external account and encrypted credential under the
  owner stored in the transferable state.
- Connection-established wake and runtime backfill then followed that stored
  owner, ultimately importing provider wearable data into that member's
  canonical vault.
- Shared ingress already rejected a supplied owner mismatch before state
  consumption; the accepted owner-binding patch made that owner mandatory at
  the hosted route/service boundary and added anonymous, wrong-member,
  preserved-state, replay, wake, backfill, and import-suppression proof.
- The first-party session cookie is a host-only `__Host-` cookie. It has no
  `Domain` attribute and therefore cannot authenticate a provider redirect to a
  separately configured device-sync hostname.
- At checked head `21fd737885b1682c5ba3275b3e6c17eb90d9b1d0`, Web URL
  resolution and Cloudflare preview/production preflight still accepted a
  split-host `DEVICE_SYNC_PUBLIC_BASE_URL`, while the successful callback-route
  unit test mocked session authentication and could not prove cookie delivery.
- The preliminary specialist review accepted that executable/configuration gap.
  The remediation keeps the owner check and rejects the split-host shape at the
  authenticated browser start, hosted Web build validator, and Cloudflare
  deploy preflight.
- `docs/device-sync-hosted-control-plane.md` already states that the callback
  consumes OAuth state only for the same member; the remediation makes the
  required same-host session transport explicit without adding another owner.

## PR intent correction

The PR description must no longer claim that a path-wide `SameSite=Lax` cookie
alone proves callback viability. After this remediation is applied, the PR
intent is:

- preserve hosted callback authentication and the exact `expectedOwnerId`
  OAuth-state owner check;
- define hosted browser OAuth as same-browser, same-member, and same-host;
- allow the `DEVICE_SYNC_PUBLIC_BASE_URL` callback/webhook path to differ while
  keeping its hostname equal to every first-party app-session URL that can serve
  the OAuth start;
- reject a browser-start hostname mismatch before OAuth state, shared ingress,
  or provider authorization;
- reject the same preview or production deployment mismatch before artifact
  render, secret sync, lifecycle mutation, or deploy;
- leave the host-only `__Host-` cookie flags, local/tunneled daemon callbacks,
  shared ingress ownership, wake/backfill/import path, and replay semantics
  unchanged; and
- report the green remediation-focused Web, Cloudflare, and device-sync proof,
  while retaining the already-green owner-binding evidence from checked head
  `21fd737885b1682c5ba3275b3e6c17eb90d9b1d0`.

## Risks and mitigations

1. Risk: provider redirects lose the first-party session and legitimate
   connections stop completing.
   Mitigation: the product remains deliberately same-browser, and the callback
   base must use the hostname that served the authenticated start. The start
   fails with a clear configuration error before OAuth state or provider
   authorization when that invariant is false. Any future cross-device or
   cross-host flow needs a deliberate member-bound handoff rather than a weaker
   cookie or state-only callback.
2. Risk: authentication or owner failure burns a valid provider state.
   Mitigation: require the app session before invoking shared ingress; shared
   ingress checks `expectedOwnerId` before state consumption. Existing focused
   regressions preserve the initiating member's valid state after an anonymous
   or wrong-member attempt.
3. Risk: deployment tooling continues to bless an unusable callback host.
   Mitigation: Web build validation and Cloudflare preview/production
   preflight use the same hostname rule. A callback path remains configurable;
   only a separate hostname is rejected.
4. Risk: a broad shared API change breaks local/tunneled daemon callbacks.
   Mitigation: the same-host check lives only on hosted Web browser starts and
   hosted deploy validation. Local/tunneled daemon callback ownership and
   configuration remain unchanged.

## Tasks

1. [x] Obtain one deletion-first ReviewGPT patch for the accepted owner-binding
   finding.
2. [x] Inspect every owner-binding hunk and reduce it to the existing app-session
   and `expectedOwnerId` owners.
3. [x] Add route/shared-ingress proof for anonymous and wrong-member callbacks,
   successful initiating-member completion, preserved state, replay, and
   downstream wake/backfill/import suppression.
4. [x] Run the preliminary specialist review and accept the concrete split-host
   callback proof/configuration finding.
5. [x] Add the hosted start-time same-host guard before ingress/state/provider
   effects, hosted Web build validation, Cloudflare preview/production
   preflight, focused tests, and current operator/security/PR-intent docs.
6. [ ] Run the remediation-focused tests, affected typechecks, canonical diff
   verification, acceptance, parent review, final ReviewGPT, and exact-final-head
   CI.
7. [ ] Commit, push, update the PR body/head/counts from the applied final diff,
   and leave the draft PR unmerged until every final gate passes.

## Verification

Required after applying the remediation patch:

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-connect-start.test.ts apps/web/test/device-sync-settings-routes.test.ts apps/web/test/next-config.test.ts apps/web/test/public-url.test.ts apps/web/test/device-sync-callback-route.test.ts apps/web/test/device-sync-hosted-wake.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/deploy-preflight.test.ts apps/cloudflare/test/deploy-worker-version.test.ts`
- `pnpm --dir packages/device-syncd exec vitest run test/public-ingress.test.ts`
- `pnpm --dir packages/device-syncd typecheck`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm test:diff packages/device-syncd apps/web apps/cloudflare`
- `pnpm verify:acceptance`
- canonical diff verification, parent review, final exact-head ReviewGPT, and
  final-head CI

Completed before the accepted preliminary-specialist remediation:

- shared public-ingress regression: 65 tests passed
- `@murphai/device-syncd` typecheck passed
- Web callback-route and hosted-wake focused suites: 108 tests passed
- Web typecheck passed

Completed after applying the accepted specialist remediation:

- The downloaded `reviewgpt-remediation.patch` matched ReviewGPT's declared
  SHA-256
  `71299cc53081d7ffb8b600d79086bf762e53390931359640719663659be1a863`,
  applied and reverse-applied cleanly, and matched the local content diff; the
  only textual diff-rendering difference was Git's configured abbreviated
  object ids.
- Focused Web proof passed 193 tests across the six callback, start, URL, and
  build-configuration files.
- Focused Cloudflare preflight/deploy proof passed 77 tests.
- Shared device-sync public-ingress proof passed 65 tests.
- Device-sync, Web, and Cloudflare typechecks passed.
- `pnpm test:diff packages/device-syncd apps/web apps/cloudflare` passed every
  global guard and affected typecheck, then passed Assistant Engine
  (2,774 tests, 8 skipped), Assistant CLI (128 tests), Assistant Runtime
  (1,935 tests, 2 skipped), and Assistantd (40 tests). The local shared-host
  lane was stopped after unchanged CLI subprocess cases accumulated exact
  60-90 second timeouts under the outer workspace artifact lock, so the already
  failed command would not spend further time in identical contention waits.
- Outside the outer artifact lock, the two reported CLI files passed 60 of 61
  tests: all 23 workout-expansion tests passed, and 37 of 38 assistant CLI tests
  passed. Only the first session-metadata test still timed out waiting for the
  contended shared artifact boundary. These files are unchanged by this branch.
- The required forced remote attempt,
  `MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance`, failed closed before
  Testbox provisioning because the installed `blacksmith-testbox` provider
  rejects the dispatcher's `--stop-after` argument. No candidate code or
  environment was uploaded, and the lane did not fall back to another local
  run.
- Canonical acceptance therefore remains blocked on the separate verification
  tooling repair. Final ReviewGPT and final-head CI remain pending.
