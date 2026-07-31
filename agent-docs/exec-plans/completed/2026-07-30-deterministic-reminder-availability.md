# Deterministic reminder availability refresh

Status: completed
Created: 2026-07-30
Updated: 2026-07-31

## Goal

- Keep `skip-when-busy` behavior while removing the model turn, model-facing
  maintenance tool, and dedicated managed automation that currently refresh
  calendar conflict snapshots.
- Refresh eligible private reminders deterministically from the hosted
  background maintenance lane, reusing the existing calendar reduction,
  authorization parser, version-fenced automation write, and delivery check.

## Success criteria

- No AI/provider turn, dynamic tool, special permission profile, or dedicated
  reminder-maintenance automation remains.
- The hosted background pass refreshes successful (including empty) snapshots
  no more than once per 24 hours from exactly the consented calendar account.
- Complete empty calendar results persist freshness without adding a database
  flag; malformed, partial, disconnected, or changed-authority results fail
  open so the reminder sends normally.
- Existing exact-time, safety-sensitive, group, and default-fixed behavior is
  unchanged.
- Focused tests, package typechecks, PR CI, and the required ReviewGPT gates
  pass on the pushed head.

## Scope

- In scope:
  - Deterministic calendar fetch/reduction and version-fenced snapshot refresh.
  - Removal of the AI-only tool, prompt/profile plumbing, and managed schedule.
  - Tests and durable architecture/security/reliability/testing documentation.
- Out of scope:
  - Calendar free/busy API migration, pagination support, new UI, new storage,
    or changing the user opt-in rules.

## Constraints

- Technical constraints:
  - Keep provider content out of persistence, prompts, and logs; persist only
    normalized UTC busy intervals and bounded freshness timestamps.
  - Preserve dependency direction and use existing vault automation records as
    the sole state owner.
  - Bound each maintenance pass and preserve cooperative yielding.
- Product/process constraints:
  - Default to fixed delivery and fail open on missing or stale evidence.
  - Preserve unrelated working-tree changes and complete the existing PR lane.

## Risks and mitigations

1. Risk: Opportunistic background maintenance could fetch too often.
   Mitigation: Persist even an empty conflict snapshot and derive due-ness from
   its canonical `generatedAt` timestamp.
2. Risk: An account or policy changes during provider I/O.
   Mitigation: Reread the exact automation and require unchanged `updatedAt`,
   authorization, and eligibility before the fenced patch.
3. Risk: One provider failure blocks all runtime maintenance.
   Mitigation: Treat each eligible reminder independently, keep prior valid
   evidence on failure, and report only aggregate secret-safe diagnostics.

## Tasks

1. Extract the existing provider request and timestamp reduction into a
   deterministic reminder-availability module.
2. Invoke it as a bounded stage of the hosted background automation pass.
3. Delete the model tool, special turn/profile plumbing, and dedicated managed
   automation.
4. Update focused tests and durable docs.
5. Run focused verification, review the diff, commit/push, update the PR, and
   complete ReviewGPT plus CI.

## Decisions

- Reuse the conflict snapshot as the cadence marker rather than introducing a
  database column or scheduler.
- Run on the first eligible hosted background pass after the snapshot becomes
  stale instead of preserving an exact 03:15 model wake.
- Let failed reads retry opportunistically instead of adding failure-throttle
  state; delivery remains fail-open while evidence is unavailable.
- Keep delivery evaluation fully deterministic and fail-open.

## Verification

- Commands to run:
  - Focused Vitest suites for availability parsing, deterministic maintenance,
    hosted runtime integration, notification delivery, managed automations,
    dynamic-tool coverage, and permission/config cleanup.
  - Typechecks for affected workspace packages.
  - Required exact-head GitHub Actions and ReviewGPT rounds.
- Expected outcomes:
  - Fresh/empty snapshots suppress redundant refresh for 24 hours.
  - Eligible stale reminders refresh from one exact account; concurrent edits,
    invalid provider data, and unavailable connected apps leave evidence
    unchanged and do not suppress delivery.
  - No provider/model request is made for maintenance itself.
Completed: 2026-07-31
