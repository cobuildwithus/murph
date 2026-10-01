# Normalize new assistant context decisions

Status: completed
Created: 2026-09-03
Updated: 2026-09-03

## Goal

- Preserve an earlier exact workout reference across unrelated assistant
  deliveries.
- Keep an explicit workout-context clear as a hard barrier.
- Make every newly written outbox intent unambiguous at one existing owner.

## Root Cause

- The read path correctly distinguishes `null` as no decision, `[]` as an
  explicit clear, and a non-empty list as exact context.
- Current outbox callers can still omit the field, while context-free scheduled
  jobs pass an empty list. Those two writer shapes turn unrelated deliveries
  into conservative legacy barriers or explicit clears.

## Architecture

- Normalize missing input to `null` inside `createAssistantOutboxIntent`, the
  single persistence owner.
- Translate a scheduled job's domain-level empty reference list to no decision
  before outbox creation.
- Preserve omitted fields only as historical read compatibility. Add no field,
  migration, state owner, service, dependency, or per-producer policy layer.

## Tasks

1. Add failing proof for missing current input and context-free scheduled jobs.
2. Normalize current writes at the outbox owner and the cron domain adapter.
3. Re-run deterministic suites, typechecks, complexity, privacy, and the
   focused real-Codex workout journey.
4. Commit, push, pass exact-head ReviewGPT and required CI, then merge and
   verify deployment.

## Product UX Walkthrough

- Unrelated manual, file, and scheduled messages remain transparent to the
  member's active workout context.
- A tracker-produced explicit clear still prevents reuse of stale workout
  context.
- Historical ambiguous rows continue to fail closed without a migration.

## Verification

- The three new boundary regressions failed before the runtime change and pass
  afterward: missing current input persists `null`, a context-free scheduled
  job passes `null`, and a vault-file send persists `null`.
- Six focused assistant runtime suites pass across outbox persistence,
  cross-session reply assembly, cron execution, vault-file delivery,
  notification turns, and service delivery.
- Assistant Engine and Operator Config typechecks pass. Agent-doc drift,
  cyclomatic-complexity diff, and diff formatting checks pass; outbox
  complexity debt decreases by three.
- The focused real-Codex journey logs the intended final set once with 12 reps,
  completes 8/8 sets, and answers without asking which workout.
- Verdict: Ready for exact-head review and CI.
Completed: 2026-09-03
