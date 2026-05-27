# Hosted Local Temporal Schedule Bootstrap

Status: completed
Created: 2026-05-27
Updated: 2026-05-27

## Goal

Make hosted-local dev startup create or update the Temporal device-sync
reconciler Schedule before the local Temporal worker starts, using the existing
idempotent schedule ensure script. Also remove the observed scheduler-only
webhook freshness dependency by making the initial dirty webhook transaction
append the durable `device-sync.wake` mailbox pointer.

## Success Criteria

- `pnpm dev` / `pnpm hosted-local up` ensures the
  `hosted-device-sync-reconciler` Temporal Schedule for local `auto`/`managed`
  Temporal, with explicit opt-in for external Temporal namespaces.
- The ensured Schedule uses the same address, namespace, task queue, web base
  URL, and Cloudflare control URL env as the local Temporal worker.
- Production keeps an explicit startup guarantee that ensures the same Schedule
  before the production worker starts.
- Focused tests and required verification pass, or unrelated blockers are
  recorded.
- Initial clean-to-dirty webhook acceptance no longer depends on the global
  recovery Schedule for first delivery; the Schedule remains a backstop for
  missed post-commit Temporal signals.
- Conversation mailbox backlog remains ahead of system-lane `device-sync.wake`
  work so this path cannot block incoming assistant replies.

## Scope

- In scope:
  - Hosted-local Temporal startup script.
  - Focused hosted-local Temporal lifecycle tests.
  - Focused device-sync webhook wake characterization test for the observed
    dirty-row recovery dependency.
  - Hosted device-sync webhook dirty wake transaction, dirty-sweeper dedupe
    identity, and demand-priority regressions.
  - Durable docs that describe the hosted device-sync wake invariant.
  - Production startup inspection/proof.
- Out of scope:
  - Changing the reconciler workflow semantics.
  - Changing device-sync dirty row processing semantics.
  - Introducing a separate scheduler or cron path.

## Constraints

- Reuse the existing idempotent Temporal Schedule ensure command.
- Do not expose secrets, personal identifiers, raw health payloads, or local
  paths in logs, docs, tests, or handoff.
- Preserve unrelated dirty work in overlapping hosted runtime and device-sync
  files.

## Tasks

1. Wire local hosted-local Temporal startup to run the Schedule ensure command
   before spawning the worker.
2. Add focused tests for env propagation, external opt-in, ordering, and
   failure cleanup.
3. Add a focused device-sync webhook test that pins the missed-dirty-nudge
   coalescing path that made the recovery Schedule necessary.
4. Replace the scheduler-only webhook dependency with a durable same-transaction
   dirty wake append and shared dirty-revision dedupe identity.
5. Prove system-lane device-sync wake demand does not outrank conversation
   mailbox backlog.
6. Confirm the production worker startup still ensures the Schedule before the
   production worker.
7. Run focused tests, typecheck, local schedule proof, and completion audits.

## Verification

- Focused hosted-local Temporal tests.
- Focused hosted device-sync wake tests.
- Production startup guard test.
- `pnpm typecheck`.
- Direct local Temporal Schedule list/describe after ensuring the local
  Schedule.

## Current State

- Local Temporal startup now ensures the reconciler Schedule for `auto` and
  `managed` modes before spawning the worker.
- External Temporal startup skips Schedule mutation by default and requires
  `MURPH_DEV_TEMPORAL_ALLOW_EXTERNAL_SCHEDULE_ENSURE=1`.
- Device-sync wake coverage now characterizes the observed failure mode: when
  the first dirty wake is missed, later level webhooks coalesce behind the
  pending dirty row and wait for recovery sweep.
- In progress: webhook acceptance now appends the dirty wake mailbox pointer
  before trace completion, shares the same dirty-revision dedupe identity with
  the recovery sweep, and signals the normal mailbox wake path after commit.
- Production startup still chains Schedule ensure before the production worker
  in `render.yaml`; direct production mutation was not attempted because
  production Temporal env is not present locally.
Completed: 2026-05-27
