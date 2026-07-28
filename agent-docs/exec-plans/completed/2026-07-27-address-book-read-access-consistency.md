# Address-book read access consistency

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Let a route-authorized live group roster read use the human owner's still-enabled
  contact projection when the owner is consented and unsuspended, even if the
  owner's personal billing is no longer an active access source.
- Keep contact replacement billing-gated and preserve every existing
  authorization, privacy, cryptography, ambiguity, and timeout boundary.

## Proven root cause

- Production successfully stored the owner's explicit contact projection and
  admitted the current group roster tool call.
- The optional label lookup returned before token derivation because it imposed
  a second personal active-access check on the owner.
- Group execution and roster authority can remain valid independently through
  the existing thread route and container access model, so the extra billing
  check silently removed presentation labels from an otherwise authorized read.

## Scope

- The address-book advisory-name read guard and focused tests.
- Current address-book product/security/architecture documentation.
- No schema, persisted state, dependency, prompt, frontend, queue, or new
  authority owner.

## Invariants

- The enclosing group tool must first prove the exact live Linq thread route.
- The projection owner must exist, remain unsuspended, hold current launch
  consent, and have an enabled projection.
- Replacement continues to require active hosted access and current consent.
- Labels remain current-turn, unverified presentation text only.
- KMS tokenization, encrypted labels, bounds, ambiguity omission, timeout, and
  fail-open truthful roster behavior remain unchanged.

## Verification

- Focused address-book projection and group-tool tests.
- Canonical `pnpm test:diff` and `pnpm verify:acceptance`.
- Direct production-condition regression scenario with an unsuspended,
  consented owner whose personal billing is inactive.
- Required product-experience, preliminary specialist, parent final, and final
  ReviewGPT gates.
Completed: 2026-07-27
