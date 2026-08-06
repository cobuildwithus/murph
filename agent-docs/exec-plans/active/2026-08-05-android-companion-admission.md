# Android Companion Admission Without Device Connection

Status: active
Owner: Codex
Started: 2026-08-05
Updated: 2026-08-05

## Goal

Add one bearer-authenticated native companion endpoint that creates or resolves
the canonical hosted member, enforces historical launch consent and active
access, enrolls an eligible untouched member in the existing Pulse trial, and
applies the existing signup time-zone handoff without creating, resuming, or
mutating any device-sync connection.

## Constraints

- Reuse `requireHostedCompanionMemberIdFromRequest` as the only canonical
  identity, consent, trial, access, and time-zone orchestration owner.
- Keep the existing companion sign-in-token connect/resume behavior unchanged.
- Accept only the closed admission request body with optional `timeZone`, and
  validate the complete body before any member mutation.
- Return only the fixed non-identifying `{ "ok": true }` success response.
- Do not instantiate device-sync public ingress or call Junction from the
  admission route.
- Add no table, queue, retry state, connection intent, SDK metadata, or second
  entitlement owner.

## Architecture

```text
native Privy identity bearer
        |
        v
POST /api/device-sync/companion/admission
        |
        +-- bounded closed request validation
        +-- existing client/header time-zone resolution
        `-- requireHostedCompanionMemberIdFromRequest
              +-- canonical identity create/recovery
              +-- historical launch-consent check
              +-- untouched-member Pulse trial enrollment
              `-- active-access assertion
        |
        v
{ "ok": true }

No public device-sync ingress or Junction boundary is reachable.
```

## Progress

- [x] Read the repository workflow, architecture, invariant, product, security,
      reliability, completion, and verification contracts relevant to the
      trust-boundary change.
- [x] Trace the current sign-in-token route and canonical companion member
      admission owner.
- [x] Add the closed admission contract and route.
- [x] Add focused validation-order, auth/admission, zero-device-ingress, and
      consent-boundary proof.
- [x] Update current architecture, security, companion, and hosted device-sync
      control-plane documentation.
- [x] Run focused tests and typecheck, then inspect the complete diff for
      privacy and scope.
- [ ] Complete required exact-head review and CI after parent integration.

## Verification

- Focused hosted Web proof: 2 files and 12 tests pass for the route contract,
  validation order, auth/consent/access propagation, and historical-consent
  boundary.
- Full `@murphai/device-syncd` package proof: 44 files and 881 tests pass,
  including the static provider-runtime import-graph guard.
- Hosted Web typecheck passes.
- Touched Web TypeScript paths pass the app-owned ESLint configuration; the
  device-syncd boundary test sits outside that app lint root and is covered by
  its full package suite.
- Broad exact-head review and CI remain owned by the eventual PR lane.

## Rollout

Deploy Web before an Android build begins calling the new endpoint. Existing
sign-in-token clients remain compatible because their route and contract do not
change. The new endpoint is additive and has no Cloudflare or Junction deploy
dependency.
