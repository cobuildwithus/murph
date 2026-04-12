# Hosted Onboarding Data Model Patch

## Goal

Land the supplied hosted onboarding data-model patch so member activation ownership moves out of `stripe-billing-policy.ts`, Stripe dispatch context construction has one shared owner, and the hosted billing/event callers reuse the shared Prisma-client seam with focused hosted-web proof.

## Why

- The current tree still mixes activation-side effects and Stripe billing freshness rules in one module.
- The supplied patch matches the repo's documented data-model seam: billing freshness/status rules should stay isolated while activation dispatch ownership becomes its own slice.

## Scope

- hosted onboarding Stripe and activation code under `apps/web/src/lib/hosted-onboarding/**`
- focused hosted onboarding Stripe/activation tests under `apps/web/test/**`
- durable doc updates only if the landed diff changes a documented rule that is not already covered

## Constraints

- Preserve unrelated concurrent `apps/web` work, especially the separate Linq home-routing lane already in progress.
- Treat the supplied patch as behavioral intent, not overwrite authority; merge it onto the current tree state instead of replaying it literally.
- Do not expose personal identifiers from local paths, usernames, or legal names in repo files, commits, or handoff text.
- Keep the landing narrow: no broader billing-model redesign, no dispatch-outcome cross-boundary changes, and no unrelated Prisma schema work.

## Verification

- Use the required `apps/web` verification lane from repo policy unless a truthful `pnpm test:diff apps/web` run already covers this slice.
- Run the focused hosted-web tests added or updated for the owner split during local iteration.
- Inspect the final diff for accidental overlap and identifier leakage before commit.

## Result

Status: completed
Updated: 2026-04-12
Completed: 2026-04-12
