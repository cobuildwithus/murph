# PR 966 Round 9 Remediation

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Resolve the two round-nine integration regressions without adding another
  cleanup owner or media-delivery service.

## Success criteria

- Account deletion makes the existing bounded Cloudflare cleanup attempt
  before acknowledging completion and retains the encrypted receipt for
  timeout or provider failure.
- Private-media capabilities use and validate the current deployment's
  expected Worker origin, keeping preview and production isolated.
- Latest `origin/main` is an ancestor of the corrected PR head.
- Focused tests, canonical diff verification, correction ReviewGPT, and
  exact-head required CI pass.

## Scope

- In scope:
  - hosted account deletion cleanup invocation and focused tests
  - private-media Worker-origin configuration, validation, and focused tests
  - deployment variables and current security/deployment documentation
  - ordinary merge overlap from the latest `origin/main`
- Out of scope:
  - new cleanup queues, receipts, schedulers, or state machines
  - changes to the encrypted capability format or R2 ownership

## Constraints

- Keep the existing receipt and hourly retry as fallback ownership.
- Keep publication and deletion serialized by the existing UserRunner lock.
- Derive Web validation from the existing hosted execution control origin.
- Preserve production's exact-origin pin and preview environment isolation.

## Tasks

1. Merge the latest `origin/main` and resolve any overlap.
2. Restore the bounded immediate deletion cleanup attempt.
3. Thread the configured Worker origin through publication and validation.
4. Add focused regression proof and update affected durable docs.
5. Run canonical verification, close the plan, push, and complete correction
   ReviewGPT plus exact-head CI.

## Decisions

- Use the existing cleanup function, receipt, deadline, and retry cron.
- Use the existing `CF_PUBLIC_BASE_URL` / hosted control URL configuration
  rather than introduce capability negotiation or environment state.

## Verification

- Pending.
