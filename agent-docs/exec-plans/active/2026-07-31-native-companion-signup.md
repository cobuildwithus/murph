# Native Companion Signup Through Canonical Hosted Onboarding

Status: active
Owner: Codex
Started: 2026-07-31
Updated: 2026-08-03

## Goal

Allow a person who verifies a phone number or email address in the native
companion app to create or recover the same canonical hosted Murph account used
by Web, accept the existing launch consent, receive the existing no-card Pulse
trial when eligible, and then obtain the existing single-use Junction SDK token.
The native app remains a thin UI and HealthKit bridge; Web remains the sole
owner of member identity, consent, billing, entitlement, activation, and device
sync admission.

## Constraints

- Reuse `completeHostedPrivyVerification`, the hosted consent registry,
  `ensureHostedAutoPulseTrialEnrollment`, canonical active-access derivation,
  and the existing companion sign-in-token endpoint.
- Do not add a native signup endpoint, client-owned onboarding stage, database
  table, entitlement kind, trial policy, SDK credential store, queue, or retry
  owner.
- Validate the companion request before any account mutation.
- A first request may create only the canonical member, identity bindings, and
  invite. It must fail with the existing consent-required response before trial
  activation or Junction authority.
- Verified email is a real Murph communication channel everywhere the shared
  onboarding flow asks whether Murph can reach the member.
- Existing active members stay on a read-only fast path and do not create or
  refresh onboarding state.
- A changed Privy principal may replace an existing member binding only when a
  Privy-verified email resolves uniquely to that same member's durable verified
  email. Phone-only mismatch and credentials split across members fail closed.
- Only members still in the canonical `not_started` billing state may be
  automatically enrolled from this companion path. Existing incomplete or
  lapsed billing stays with its current recovery owner.

## Architecture

```text
native phone/email OTP
        |
        v
Privy identity-token bearer auth
        |
        v
POST /api/device-sync/companion/sign-in-token
        |
        +-- validate existing companion request contract
        |
        +-- existing active member -> historical-consent check
        |
        `-- inactive or missing member
              |
              +-- completeHostedPrivyVerification
              +-- historical-consent check
              +-- existing active-access recheck
              `-- not_started only -> ensureHostedAutoPulseTrialEnrollment
        |
        v
canonical active-access assertion
        |
        v
existing single-use Junction sign-in token
```

Native consent recovery already retries this same request after accepting the
server-provided launch scopes, so no new continuation state is needed.

## Planned Changes

### `murph`

- Add one companion member-access orchestration service.
- Route the existing companion token endpoint through that service.
- Treat verified email as setup-complete in the shared messaging-readiness
  predicate, completion projection, invite projection, and billing precondition.
- Add focused service, route, messaging, and precondition tests.
- Update companion architecture, reliability, security, and verification docs.

### `murph-ios`

- No runtime contract or state-machine change is expected.
- Update architecture, MVP, App Store submission, and metadata documentation so
  the shipped phone/email OTP flow is accurately described as sign-in or account
  creation backed by canonical hosted onboarding.

## Progress

- [x] Re-read repository instructions, architecture, security, reliability,
      hosted onboarding, consent, trial, entitlement, companion, and native
      session code on the latest `main` heads.
- [x] Confirmed no overlapping branch or open pull request.
- [x] Confirmed the native app already has complete phone/email OTP and consent
      continuation; no new native API field is necessary.
- [x] Implement the hosted orchestration and shared email readiness.
- [x] Add the original focused proof and documentation.
- [x] Reproduce the production native email recovery failure from typed logs
      and narrow read-only member facts without creating a duplicate member.
- [x] Preserve phone-only mismatch while allowing a changed Privy principal
      whose verified email uniquely resolves to the same member.
- [x] Add focused success and fail-closed regression proof.
- [ ] Complete the hotfix PR's exact-head CI and ReviewGPT gates.
- [ ] Deploy Web and verify the native retry succeeds without an app update.

## Verification

Focused Web proof:

```sh
pnpm --filter @murph/web test -- \
  test/hosted-onboarding-companion-member-access.test.ts \
  test/device-sync-companion-signup-route.test.ts \
  test/hosted-onboarding-messaging-state.test.ts \
  test/hosted-onboarding-billing-start-preconditions.test.ts
pnpm --filter @murph/web typecheck
```

Broad PR proof remains owned by exact-head GitHub Actions. The iOS companion
change is documentation-only unless implementation evidence disproves the
current no-client-change conclusion.

2026-08-03 hotfix proof:

```sh
pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage \
  apps/web/test/hosted-onboarding-member-identity-service.test.ts \
  apps/web/test/hosted-onboarding-privy-service.test.ts \
  apps/web/test/hosted-onboarding-companion-member-access.test.ts \
  apps/web/test/device-sync-companion-signup-route.test.ts
pnpm --dir apps/web typecheck
```

The four focused suites pass all 52 cases, including verified-email recovery,
phone-only rejection, cross-member email rejection, shared onboarding, and the
companion route. The prepared typecheck initially found the fresh worktree's
expected missing generated Health Commons input; the canonical Web typecheck
generated that source-owned input and then passed.

## Rollout

Deploy Web first. Existing native builds are forward-compatible because the
request and response bodies do not change. Confirm a fresh phone identity and a
fresh email identity each create one member, stop at native consent, resume into
one Pulse trial, and obtain one Junction session. The iOS documentation PR may
land independently but should be merged before the next App Store submission.
