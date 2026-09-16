# Repair legacy approval accounts inline after Privy retirement

Status: completed
Created: 2026-09-16
Updated: 2026-09-16

## Goal

Let a member with legacy approval protection and no Murph passkey add a Murph
passkey from the existing approval flow after Privy becomes unavailable, then
approve the same action. Delegate the implementation to ReviewGPT and inspect
its returned patch before local integration.

## Success criteria

- An eligible legacy member can repair from the approval button without Privy,
  a Settings detour, or a previously saved recovery key.
- Repair has an explicit fresh first-party authentication policy for the same
  member and canonical bound sign-in identity. Its security tradeoff is documented.
- Existing Murph approval credentials cannot be replaced or bypassed by repair.
- Enrollment and action approval remain separately bound, verified operations.
- Focused client, real WebAuthn and database concurrency proof, typecheck, and
  rendered journey checks pass; unavailable checks are reported honestly.

## Scope

- Existing sensitive-action authentication, passkey enrollment/recovery,
  first-party reauthentication continuation, approval UI, tests and owner docs.
- Full Privy removal from unrelated login/native/cleanup code, provider account
  deletion, production configuration and deployment are outside this task.

## Current owner and evidence

The authentication-options route selects the legacy wallet when the member has
no native approval credentials. Initial enrollment excludes legacy identities;
protected-member enrollment requires existing-factor proof. Saved-key recovery
cannot repair a legacy member who never migrated. The sensitive-action owner
and encrypted credential aggregate remain authoritative; first-party auth owns
fresh primary proof and session revocation. No private account evidence belongs
in this plan or the implementation packet.

## Design constraints

Prefer extending the existing enrollment and authorization owners over new
services, duplicate credential state or a general recovery framework. Derive
eligibility from canonical state and recheck under existing member/session locks.
Keep network/KMS preparation outside short transactions. Bound challenges and
storage; preserve replay protection, counter state and exact action binding.
Do not use an old cookie, silent exchange, unverified routing contact or approval
URL as repair authority. Make the new legacy-only policy explicit in current
auth/security owners. Do not weaken established Murph passkey recovery.

## Product UX

Journeys to replay: legacy member with fresh proof; stale proof and inline
reauthentication; established native passkey; new unprotected member; registration
cancellation/failure; concurrent enrollment; lost registration response; expired,
denied or already approved link; return to the original conversation. Preserve
action context and understandable retry/cancel states. Initial disposition: Hold
until the returned implementation and evidence are reviewed.

## Failure and deployment

Registration must not itself approve an action. Re-read committed credential
state after ambiguous responses. Existing passkey presence or unreadable state
must fail closed for repair. The returned design must state rollout activation,
compatible-reader requirements and rollback floor; no production mutation is
authorized by this task.

## Tasks

1. Send the scoped implementation request and guarded snapshot to ReviewGPT. Done.
2. Capture and inspect the downloadable patch and its assumptions. Done.
3. Integrate into this isolated checkout; resolve concrete correctness gaps. Done:
   standalone account-settings page still mounted the provider; a test expected
   the old wrapper; the repair fixtures created new accounts and then marked
   them legacy instead of matching imported accounts.
4. Run focused proof, typecheck and rendered journeys; inspect the full diff. Done.
5. Complete the authorized scoped commit and report remaining rollout gates.

## Decisions

- ReviewGPT is explicitly requested for implementation, not a final PR audit.
- Keep this Codex session as completion owner using attached response capture.
- Base snapshot: `3b677bd7d6c34c7ac0c0c46ba1bb6b66291401dc`.
- Final recovery policy: an already-bound canonical verified first-party sign-in,
  proved within five minutes, may establish the first Murph passkey for a member
  whose approval state never migrated. The approval and Settings controls select
  this repair instead of wallet restoration, so the browser approval path no
  longer loads the provider. Documented as a weaker-factor tradeoff in
  `agent-docs/SECURITY.md` and `docs/hosted-auth-migration.md`.
- The auth panel's reauthentication branch is consolidated into one request
  context helper so the complexity guard stays at its prior ceiling.
- The rendered proof lives in the Messages screenshots category, whose study
  cells sit under a page-level inert container; the capture spec clears inert
  on every ancestor, matching the Better Auth adoption proof spec.
- No deployment, switch, or production data change is part of this task.

## Verification

Select existing focused sensitive-action client/route and real WebAuthn/Postgres
fixtures from the returned changed paths. Run the Web typecheck, complexity diff,
docs checks, and synthetic rendered journey proof where applicable. Before integration, the existing `approval-passkey-enrollment-client.test.tsx`
and `action-approval-client-auth.test.tsx` suites passed: 2 files, 9 tests, using
`pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage` with
those exact paths. That was baseline evidence only.

After integration, on the final candidate:

- Web typecheck: `node scripts/run-typescript.mjs web -p apps/web/tsconfig.json --pretty false` passed.
- PostgreSQL lane (`better-auth-member-postgres-concurrency`, `better-auth-telegram-postgres-concurrency`
  and two sibling files): 4 files, 126 tests passed with real WebAuthn fixtures and
  an isolated local database; Privy is never called.
- Client/route lane (ten files including `legacy-approval-repair-client`,
  `auth-reauthentication-continuation`, `action-approval-page`,
  `better-auth-login-client`, `better-auth-telegram-client`, settings pages and
  the changelog loader): 148 tests passed; the four auth-panel files were rerun
  after the complexity fix (46 tests passed).
- `pnpm complexity:diff` passes; the only regression (auth panel 20 -> 22) was
  removed by deriving the reauthentication request context once.
- Rendered journey proof: `apps/web/e2e/pr-legacy-approval-repair-design-proof.spec.ts`
  drives the real `ActionApprovalCard` at 390 and 1280 px with stubbed routes and
  a virtual authenticator: fresh proof, stale proof with inline reauthentication
  cancel and retry, registration before a separate assertion, and no provider
  requests. All four journeys (two viewports, fresh and stale proof) pass
  through the smoke Playwright environment; captures are kept under the
  ignored review artifacts folder.
- ESLint passes on every changed web file.
- Read-only production inventory (aggregate only): 132 legacy identities have no
  Murph approval credentials; 131 of them already have a Better Auth user row and
  a canonical verified email, phone or Telegram method. One has no canonical
  verified method and stays an unresolved retirement gate.
Completed: 2026-09-16
