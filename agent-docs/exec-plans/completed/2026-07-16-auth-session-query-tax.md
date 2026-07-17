# Merge hosted app-session and member core-state reads

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- `resolveHostedAppSessionFromToken` runs on every authenticated request and
  cost two sequential queries: `hostedWebSession.findUnique` then
  `hostedMember.findUnique` for the core state. Fetch the member core state
  through the session row's `member` relation in the same query, cutting the
  per-request auth tax from 3 sequential queries to 2 on
  `requireActiveHostedAppSessionFromRequest` paths (and 2 to 1 for plain
  session reads).

## Success criteria

- Session resolution semantics unchanged: authenticator verification,
  revocation, and expiry checks still gate the result; a forged or tampered
  token still resolves to null; the returned `HostedAppSession` shape is
  identical.
- `assertActiveHostedMemberAccessAllowed` (the unified access resolver) is
  untouched.
- Session tests updated to the joined read shape and passing; scoped
  verification passes.

## Scope

- In scope: `apps/web/src/lib/hosted-onboarding/app-session.ts`,
  `apps/web/test/hosted-app-session.test.ts`.
- Out of scope: member-access policy, Privy auth, session issuance/revocation
  logic, request-level caching changes.

## Constraints

- Auth trust boundary: no weakening of fail-closed behavior. The joined read
  fetches member core state in the same statement as the session row; when
  the authenticator check fails the result is discarded and resolution still
  returns null.
Completed: 2026-07-16
