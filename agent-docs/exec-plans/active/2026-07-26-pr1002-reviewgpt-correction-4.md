# pr1002-reviewgpt-correction-4

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Close PR 1002's remaining exact-head ReviewGPT findings without weakening the
  account-deletion commitment boundary or adding lifecycle state.

## Success criteria

- A live start is rejected before any expired-marker provider cleanup begins.
- The member suspension commits before destructive expired-marker cleanup.
- URL-only OAuth expiry is classified without current provider credentials.
- Unknown and owner-creating providers without cleanup support remain
  fail-closed.
- Focused unit and real-PostgreSQL ordering tests pass.
- The draft PR is reconciled with current `main`, CI passes, and the exact
  PR-specific patch receives a passing ReviewGPT correction.

## Scope

- In scope: hosted account-deletion ordering, configuration-independent provider
  classification, focused lifecycle tests, design-evidence packaging, and PR
  evidence.
- Out of scope: new persistence, background cleanup, provider onboarding
  redesign, merging the draft PR, or unrelated device-sync changes.

## Constraints

- Reuse the existing pending marker, deletion cutoff, hosted-member lock,
  provider manifest, and provider cleanup interface.
- Keep provider I/O outside database transactions.
- Preserve truthful pre-start Cancel behavior and the ambiguous/reload recovery
  path after suspension commits.

## Risks and mitigations

1. Risk: an expired marker is cleaned before a live sibling rejects deletion.
   Mitigation: read-only preflight before provider I/O and a cutoff-consistent
   recheck under the member locks.
2. Risk: a provider disabled after an OAuth start blocks deletion forever.
   Mitigation: classify known URL-only OAuth providers from the canonical
   configuration-independent manifest.
3. Risk: a new live marker stages between preflight and suspension.
   Mitigation: recheck the same live-at-cutoff predicate inside the suspension
   transaction before writing `suspendedAt`.

## Tasks

1. Split pending-start handling into read-only live preflight, locked suspension,
   and post-suspension expired cleanup.
2. Resolve URL-only OAuth classification from the canonical provider manifest
   before constructing a configured provider registry.
3. Add mixed expired/live, staging-barrier, cleanup-order, missing-config, and
   fail-closed tests.
4. Package the rendered retry-state evidence claimed by the PR body.
5. Run scoped and canonical verification, reconcile `main`, update the draft PR,
   and complete the exact-head review/CI gate.

## Decisions

- Suspension is the deletion authority boundary. Live markers may reject only
  before that boundary; destructive provider cleanup happens only after it.
- The existing deletion cutoff determines which markers are live for both the
  initial preflight and locked recheck.
- Provider capability configuration and provider lifecycle classification are
  separate concerns; URL-only OAuth classification must not require credentials.

## Verification

- Pending.
