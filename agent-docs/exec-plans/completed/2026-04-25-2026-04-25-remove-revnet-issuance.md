# Remove Revnet issuance from hosted onboarding

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Remove hosted Revnet issuance from the live codebase, including runtime helpers, Stripe issuance/reconciliation paths, Prisma model/enums, route wiring, and directly coupled tests/docs.
- Hosted onboarding and subscription billing should activate from the current Stripe/member state without wallet/Revnet issuance prerequisites.

## Success criteria

- No live app/package source, tests, Prisma schema, or current docs reference Revnet issuance.
- The hosted database schema no longer defines the Revnet issuance table or enum.
- Stripe webhook/cron/reconciliation paths no longer create, drain, repair, or reconcile Revnet issuance rows.
- Wallet normalization remains only where it is still directly needed for optional stored wallet identity, not Revnet gating.
- Required verification and completion audits are run or blockers are documented.

## Scope

- In scope:
  - `apps/web` hosted onboarding, billing, Privy/member identity, Stripe cron/webhook, Prisma schema/migrations, and tests.
  - Current durable docs that describe Revnet as live or disabled behavior.
- Out of scope:
  - Historical completed execution-plan snapshots and release history/changelog entries, which are immutable or archival.
  - Unrelated hosted runtime, vault-sync, retention, and Cloudflare changes already dirty in this checkout.

## Constraints

- Technical constraints:
  - Preserve hosted Stripe subscription activation semantics except for removing Revnet issuance coupling.
  - Do not weaken auth/session, billing, or hosted execution invariants to satisfy tests.
  - Remove schema-owned state explicitly rather than leaving unused tables/helpers.
- Product/process constraints:
  - Preserve unrelated working-tree edits and active ledger rows.
  - Use the high-risk completion workflow for hosted-web/schema changes.
  - Do not edit completed execution-plan snapshots.

## Risks and mitigations

1. Risk: Removing Revnet helper modules breaks still-valid wallet identity normalization.
   Mitigation: Keep a small neutral wallet-address helper only if callers still use optional wallet identity, and update imports/tests accordingly.
2. Risk: Prisma/generated-client drift after schema deletion.
   Mitigation: Run hosted-web Prisma generation through the app verification lane or an explicit `prisma generate` proof if a narrower loop is needed.
3. Risk: Active hosted-web edits overlap this cleanup.
   Mitigation: Inspect diffs before edits, touch only Revnet-owned files plus directly coupled callers/tests/docs, and stop if overlap makes scoped commit unsafe.

## Tasks

1. Map all live Revnet references and classify archival references that should remain.
2. Remove Revnet Prisma model/enum/migration assumptions and regenerate/update affected tests.
3. Delete Revnet issuance, repair, reconciliation, and submission modules/routes/tests.
4. Simplify Stripe webhook/cron/billing/member activation/entitlement paths around non-Revnet activation.
5. Update current docs and verification references.
6. Run focused verification, required audits, and scoped completion/commit flow.

## Decisions

- Treat historical completed plan snapshots and release notes as archival, not live codebase surface.
- Keep optional wallet identity support only where non-Revnet hosted member identity still uses it.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff <touched paths>`
  - `pnpm verify:acceptance` unless an unrelated pre-existing blocker prevents it
  - `git diff --check -- <touched paths>`
- Expected outcomes:
  - Hosted-web type/schema/tests remain green for the touched surface, or any red checks are documented as unrelated pre-existing blockers.
Completed: 2026-04-25
