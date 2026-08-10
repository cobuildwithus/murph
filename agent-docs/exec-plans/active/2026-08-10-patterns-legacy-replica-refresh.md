# Refresh legacy Browser Vault replicas for Patterns

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Make Patterns available to existing members without requiring a health-data
  change or a manual refresh action.

## Success criteria

- Browser Vault replicas created before the Patterns projection are classified
  as stale.
- Opening the signed-in app schedules the existing Browser Vault refresh path.
- The current polling flow replaces the preparing state when the refreshed
  replica is ready, including when publication takes more than 20 seconds.
- Focused generation, freshness, Web session, and Patterns page tests pass.
- Exact-head CI and required ReviewGPT checks pass.

## Scope

- In scope:
  - Advance the Browser Vault replica generation for the new Patterns
    projection.
  - Continue the existing browser-owned polling at a slower interval after its
    fast window until the pending refresh completes.
  - Update focused generation expectations and legacy-refresh coverage.
- Out of scope:
  - New refresh routes, queues, cron jobs, or persisted state.
  - Manual refresh controls.
  - Changes to pattern detection or scoring.

## Constraints

- Reuse the existing generation-aware freshness check, mailbox control event,
  Temporal wake, runtime materialization, and browser polling flow.
- Keep prior-generation replicas readable while their replacement is prepared.
- Preserve the current Browser Vault privacy and authority boundaries.

## Tasks

1. Advance the Browser Vault replica generation and update focused contracts.
2. Prove prior-generation replicas schedule refresh and remain readable.
3. Run focused tests and inspect the final diff.
4. Commit, push, open a PR, and complete required ReviewGPT and CI gates.
5. Perform the parent final review and close this plan.

## Decisions

- Use the existing replica generation seam. The Patterns projection changed the
  derived replica shape, so a generation advance is the canonical invalidation
  signal.
- Do not add a feature-specific refresh request. The existing freshness owner
  already schedules and deduplicates refresh work for an older generation.
- Keep the existing 1.5-second fast polling window, then slow to 15-second
  checks. This retains automatic completion without indefinite fast polling or
  a new continuation owner.

## Verification

- Query and hosted-execution focused Vitest suite: 4 files, 58 tests passed.
- Browser Vault Web session, dashboard, and polling suite: 3 files, 99 tests
  passed after the standard Prisma client generation step.
- Contracts, Query, Hosted Execution, and Web typechecks passed.
- Direct contract proof: a generation-4 replica is readable but the Web session
  classifies it as `generation_mismatch`, schedules the existing refresh
  control event, and returns `refreshPending: true` for browser polling.
- Preliminary ReviewGPT returned two accepted findings with one mechanism: the
  fast browser polling owner stopped after 20 seconds, and no test proved the
  terminal generation-4 to generation-5 journey. The browser now continues at
  a 15-second slow interval while refresh remains pending. A fake-timer
  BrowserVaultProvider test delays publication beyond the fast window and
  proves the open page adopts a generation-5 replica with Personal Patterns
  without focus, navigation, or a manual action.
- Pending: pushed-head ReviewGPT, exact-head CI, parent final review, and plan
  closure.
