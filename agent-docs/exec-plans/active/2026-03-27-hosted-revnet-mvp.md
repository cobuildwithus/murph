# Hosted RevNet MVP

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

- Add the hosted onboarding RevNet MVP so Stripe subscription invoices can trigger safe, invoice-idempotent onchain issuance to the member wallet after payment succeeds.

## Success criteria

- Hosted billing checkout accepts an optional `walletAddress`, persists a validated wallet on the member, and forwards it into Stripe metadata.
- `apps/web` has explicit RevNet env parsing plus a helper that approves ERC-20 spend and submits `JBMultiTerminal.pay(...)`.
- Prisma adds an issuance table that records invoice-level idempotency plus Stripe-to-onchain transaction linkage.
- `invoice.paid` activates the member only after any configured RevNet confirmation wait completes.
- Focused tests prove checkout wallet forwarding and invoice-paid RevNet issuance idempotency.
- Docs/runtime notes mention the new hosted onboarding onchain dependency and assumptions without overstating reversibility.

## Scope

- In scope:
  - hosted onboarding env parsing and `.env.example`
  - hosted onboarding billing route/service wiring
  - hosted onboarding Stripe webhook handling
  - Prisma schema + migration for hosted RevNet issuance
  - focused hosted onboarding tests
  - minimal architecture/verification/docs updates for truthful runtime guidance
- Out of scope:
  - chargeback or dispute clawback logic
  - generalized onchain payout infrastructure outside hosted onboarding
  - public landing page or Privy flow redesign

## Constraints

- RevNet issuance only runs when hosted Stripe billing mode is `subscription`.
- The hosted treasury wallet is assumed to be pre-funded onchain.
- Existing hosted member wallet matching semantics must stay stable for the current repo state.
- Repo policy asks for delegated audit passes, but this session can only spawn subagents when the user explicitly authorizes them.

## Tasks

1. Reconcile the provided patch against the current hosted onboarding baseline.
2. Add schema/runtime/service changes with a narrow `apps/web` write set.
3. Add focused tests for wallet forwarding and invoice-paid issuance idempotency.
4. Update architecture/runtime docs so the new trust boundary and verification surface are explicit.
5. Run required checks, perform local review, and report the blocked delegated-audit requirement if it remains unauthorized.
