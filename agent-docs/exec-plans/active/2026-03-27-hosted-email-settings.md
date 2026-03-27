# Hosted email settings in `apps/web`

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

- Implement the hosted `/settings` flow so an active hosted member can add or update the email linked to the matching Privy identity.
- Keep the change narrow: reuse the existing hosted session/Privy provider wiring, add a success-state entry point, and cover the linked-account parsing plus server page wiring with focused tests.

## Success criteria

- `GET /settings` renders a hosted account settings page that requires an active hosted session before showing the email-management flow.
- The client settings flow only proceeds when the logged-in Privy user id matches the hosted session's Privy user id.
- The UI can send an OTP to a valid new email address, open an OTP dialog, verify the code, and surface the linked email from the updated Privy user state.
- Shared Privy linked-account helpers can extract an email account from both SDK-style and identity-token-style linked-account shapes.
- Focused `apps/web` tests cover the settings page wiring and the linked-account helper behavior.

## Scope

- In scope:
  - hosted `/settings` page and its client email settings component
  - success-state discoverability link from hosted invite completion
  - shared Privy linked-account email extraction helper
  - focused hosted-web tests and minimal docs/dependency updates needed by the feature
- Out of scope:
  - server-side mutation routes for email updates
  - broader hosted onboarding copy or layout cleanup
  - changes to billing, share-import, or device-sync behavior

## Constraints

- Preserve adjacent dirty `apps/web` work, especially in hosted onboarding surfaces already under active development.
- Keep the Privy flow browser-initiated through the existing SDK provider; do not invent a parallel backend email-verification path.
- Keep the UI scoped to active hosted members with a matching Privy identity and fail closed on mismatch.

## Risks and mitigations

1. Risk: the browser could be signed into a different Privy user than the current hosted session.
   Mitigation: gate the flow on an explicit `expectedPrivyUserId` check and offer sign-out when the browser session mismatches.
2. Risk: Privy linked-account payloads vary between SDK user objects and verified identity-token shapes.
   Mitigation: extend the shared linked-account helper and add focused tests for both shapes.
3. Risk: the patch could clobber adjacent dirty onboarding UI changes.
   Mitigation: patch only the active success-state block in `join-invite-client.tsx` and leave unrelated dirty edits intact.

## Tasks

1. Add the `/settings` page and client email settings component.
2. Extend shared Privy helpers with email-account extraction and wire the success-state settings link.
3. Update focused tests and the hosted-web dependency/docs metadata.
4. Run focused `apps/web` verification and then broader required checks if the dirty tree allows it.

## Outcome

- Added a hosted `/settings` route plus a client Privy email-verification flow that is pinned to the active hosted member's Privy user id.
- Extended shared Privy linked-account parsing to surface verified email accounts from both SDK and identity-token shapes.
- Added discoverability from the hosted invite success state and updated hosted-web docs/env guidance plus the Radix dialog dependency.
- Focused hosted-web verification passed with `pnpm --dir apps/web test`.
- Direct UI proof passed for the signed-out `/settings` state at desktop and mobile widths using Playwright screenshots against the built app.
- Repo-wide wrappers remain red outside this lane:
  - `pnpm typecheck` fails in `packages/query` with a pre-existing `packages/runtime-state/dist/index.d.ts` build-output mismatch.
  - `pnpm test` fails in unrelated `packages/cli` suites (`assistant-service`, `runtime`, and `search-runtime`).
  - `pnpm test:coverage` fails in the same unrelated `packages/cli` suites.
