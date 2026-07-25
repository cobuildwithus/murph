# PR 952 prepared-only crypto transaction API

Status: active
Created: 2026-07-25
Updated: 2026-07-25

## Goal

- Make the transaction provisioning API strictly prepared-only so transaction
  and advisory-lock code cannot call signing or KMS.

## Success criteria

- Prepared candidates are mandatory at the transaction API boundary.
- A missing matching candidate after the locked re-read throws a typed error
  without signing.
- Activation passes prepared candidates before its transaction.
- Thread-container creation either passes prepared candidates at its owner or is
  explicitly split only if moving identity generation materially widens scope.
- Focused, full acceptance, specialist ReviewGPT, final parent review, final
  ReviewGPT, and CI are green on the pushed head.

## Scope

- In scope: domain-root prepare/commit API, activation and thread-container
  callers, focused KMS-ordering and failure tests.
- Out of scope: prewarming crypto state, new persisted candidate state, queues,
  or a generic provisioning framework.

## Constraints

- Technical constraints: retain advisory lock plus re-read race protection,
  envelope binding validation, and key zeroization.
- Product/process constraints: preserve activation and group creation success
  paths while making provider-free transaction code mechanically enforceable.

## Risks and mitigations

1. Risk: an omitted candidate turns a recoverable race into an opaque failure.
   Mitigation: use a typed error and ensure every transaction owner prepares all
   required domains before opening.
2. Risk: caller wiring duplicates domain selection.
   Mitigation: reuse the existing preparation helper and domain catalog.

## Tasks

1. Trace all transaction provisioning callers and fallback signing paths.
2. Split strict prepared commit API from provider-bearing preparation.
3. Wire activation and thread-container transaction owners.
4. Add no-signing-under-transaction proof and run the required gates.

## Decisions

- Enforce the invariant through function signatures and typed failure, not
  optional parameters or caller convention.

## Verification

- Commands to run: focused hosted crypto and onboarding tests,
  `pnpm test:diff apps/web/src/lib/hosted-crypto/domain-root-store.ts`,
  `pnpm verify:acceptance`, and the repository ReviewGPT/CI gates.
- Expected outcomes: all pass; mutation/removal of a prepared candidate fails
  before any signing fallback can occur.
