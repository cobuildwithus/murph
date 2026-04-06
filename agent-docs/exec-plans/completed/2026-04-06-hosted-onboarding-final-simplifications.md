# Land final hosted onboarding simplifications

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Land the supplied hosted onboarding simplifications so hosted identity is anchored on verified phone plus Privy user id, wallet persistence stays additive, invite/share stage gating respects suspension, and client completion no longer blocks on embedded-wallet creation before RevNet-backed billing needs it.

## Success criteria

- Hosted Privy verification accepts phone-only server-side sessions unless RevNet is enabled.
- Hosted member identity reconciliation never clears an existing stored wallet when the current Privy session has not produced one yet.
- Invite status and share-page session gating treat suspended members as inactive and do not require wallet presence to count as Privy identity outside RevNet-backed flows.
- The hosted onboarding client completes after verified phone with best-effort wallet provisioning.
- Hosted-web tests, lint, and repo baseline verification pass.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-onboarding/{privy,privy-client,member-identity-service,invite-service}.ts`
  - `apps/web/src/components/hosted-onboarding/hosted-phone-auth.tsx`
  - `apps/web/src/lib/hosted-share/link-service.ts`
  - matching hosted-web tests
  - hosted docs wording in `apps/web/README.md` and `ARCHITECTURE.md`
- Out of scope:
  - wide `HostedMember` row split and Prisma migration follow-up beyond already-landed work
  - Cloudflare/runtime behavior changes unrelated to hosted onboarding/share gating

## Constraints

- Technical constraints:
  - Preserve adjacent in-progress hosted-member privacy changes already in the worktree.
  - Keep RevNet-backed wallet enforcement intact where billing/issuance truly requires it.
- Product/process constraints:
  - Treat auth, wallet, billing, and share-access surfaces as high-risk.
  - Same-turn completion requires the repo workflow: full verification, final audit pass, and scoped commit.

## Risks and mitigations

1. Risk: loosening wallet requirements could accidentally weaken RevNet-backed flows.
   Mitigation: gate only generic hosted identity/completion logic; keep RevNet wallet enforcement in server-side identity resolution and billing paths.
2. Risk: additive wallet writes could mask wallet conflicts.
   Mitigation: keep mismatch detection when both an existing stored wallet and a new Privy wallet are present.
3. Risk: adjacent dirty hosted-web files could be overwritten.
   Mitigation: port only the targeted delta and verify the final diff by file.

## Tasks

1. Compare the supplied patch intent against the live hosted onboarding/share code and existing dirty-tree edits.
2. Apply the missing deltas in runtime code, tests, and hosted docs.
3. Run the required hosted-web and repo verification commands plus a direct scenario-oriented proof via targeted tests.
4. Run the required completion audit, address any findings, and re-run affected checks.
5. Close the plan with a scoped commit.

## Decisions

- Treat the supplied patch as intent and integrate only the missing deltas on top of the current hosted-member privacy split work.
- Use the existing `hasHostedMemberActiveAccess` helper for suspended-member share gating instead of duplicating billing-status checks.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:coverage`
  - `pnpm --dir apps/web lint`
- Expected outcomes:
  - Repo baseline and hosted-web lint pass, with targeted hosted-web tests directly proving the relaxed identity and suspended-access behavior.
Completed: 2026-04-06
