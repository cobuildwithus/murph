# PR 962 group usage limit and merge reconciliation

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Make every newly created hosted group chat start with exactly $7.50 of
  included usage, and restore PR #962 to a clean merge state against current
  `main`.

## Success criteria

- Linq and Telegram group-thread creation persist `7_500_000` USD micros when
  no explicit override is supplied.
- Existing group-chat allowance rows remain unchanged.
- The Prisma model and database default agree with the creation owner without
  rewriting historical migrations.
- The two current merge conflicts are resolved while preserving both PR and
  `main` behavior.
- Focused coverage, canonical verification, product review, preliminary
  specialist review, parent final review, final ReviewGPT, CI, and mergeability
  proof pass on the pushed head.

## Scope

- In scope: hosted thread-container creation default, its database default,
  focused regressions, current group-usage product documentation, and PR #962
  conflict resolution.
- Out of scope: trial usage, existing group rows, paid-plan 80% derivation,
  purchased usage credit, plan prices, new state owners, and runtime-module
  changes.

## Constraints

- Technical constraints: keep the existing `HostedThreadContainer` allowance
  owner and explicit creation write; use one additive default-only migration;
  preserve all current allowance settlement and period behavior.
- Product/process constraints: do not retroactively increase existing groups;
  do not edit historical migrations or completed plan snapshots; keep the PR
  ready for review.

## Risks and mitigations

1. Risk: changing the unrelated Pulse Trial limit because it also equals
   $4.50.
   Mitigation: touch only the thread-container constant, schema/default
   migration, group creation assertions, and group-usage documentation.
2. Risk: updating application code but leaving the database fallback at $4.50.
   Mitigation: add a forward migration that changes only the column default and
   prove both schema and migration text.
3. Risk: conflict resolution drops either the PR's paid-usage cutover coverage
   or newer `main` migration inventory.
   Mitigation: inspect base/ours/theirs for both conflicted files, preserve the
   union of current invariants, and rerun the production migration guard.

## Tasks

1. Resolve the two `main` merge conflicts with a normal merge.
2. Change the new-group allowance owner and database default to $7.50.
3. Add focused creation and migration regressions and update the live
   group-usage spec.
4. Run canonical verification and direct source/migration proof.
5. Complete required reviews, close the plan through `scripts/finish-task`,
   push the exact head, and wait for green CI plus clean mergeability.

## Decisions

- The request applies only to groups created after this change; existing
  persisted group limits are not rewritten.
- Keep the explicit service-layer write as the authoritative creation path and
  align the database default as a fail-safe, rather than relying on an implicit
  Prisma default.
- Product-experience review passed with no findings: both provider entry points
  reuse the existing creation owner, and the change adds no interaction,
  permission, continuation, delivery, or recovery concept.
- Preliminary specialist review returned one accepted coverage finding in the
  pre-existing paid-plan scope: `invoice.paid` and `invoice.payment_failed`
  needed direct-to-Family reconciliation regressions. The test-only artifact
  at index 0 from the Eragon review thread was inspected, path-checked, and
  applied without production changes.

## Verification

- Commands to run: focused hosted group-route and migration tests; canonical
  `pnpm test:diff` for every touched Web owner; `git diff --check`; clean
  synthetic merge proof; exact-head GitHub CI and ReviewGPT.
- Expected outcomes: new group creation and the database fallback both use
  `7_500_000`, existing rows are untouched, all checks pass, and PR #962 is
  mergeable.
- Completed proof: the focused Linq route, Telegram dispatch, and migration
  suites passed 89/89; Prisma schema validation and agent-docs drift checks
  passed. Canonical diff verification passed in Blacksmith Testbox
  `tbx_01kyerhrtem0ts8jx3q9fwkpwf`.
- Specialist remediation proof: the focused Stripe billing-events suite passed
  36/36; canonical diff verification passed with 6,722 hosted Web tests, Web
  TypeScript, lint with zero errors, dev smoke, and the production build.
