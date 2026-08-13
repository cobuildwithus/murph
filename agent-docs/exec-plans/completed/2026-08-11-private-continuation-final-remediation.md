# Close private completion continuity review gaps

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Resolve the three accepted ReviewGPT round-3 findings without exceeding the
  completed architecture retrospective's existing-owner boundary.

## Success criteria

- Pre-rollout private-completion intents without the binding field fail closed.
- A delivered current-format obligation survives terminal pruning until its
  exact-session import is applied.
- Generic notifications omit continuity fields and retain their prior persisted
  outbox shape.
- Focused tests, owning typechecks, docs drift, final ReviewGPT, and exact-head
  CI pass before merge.

## Scope

- In scope: the existing continuity predicate, terminal-pruning predicate,
  notification field propagation, focused regression tests, and rollout docs.
- Out of scope: migration, backfill, new state owners, new queues, deployment,
  or route-based legacy inference.

## Tasks

1. Fail closed on omitted bindings and omit the field from generic writes.
2. Protect delivered unresolved obligations with the existing prune predicate.
3. Prove real dispatch, sent finalization, pruning, first-direct import, and
   restored pruning after application.
4. Push the corrected head and complete ReviewGPT plus CI.
5. Merge the PR and retire the task worktree.

## Decisions

- All round-3 findings are accepted after direct production-path inspection.
- The correction stays within existing outbox, session, transcript, importer,
  and pruning ownership; no compatibility machinery or inference is added.
- Deployment uses Web first and an immediate Cloudflare runner rollout because
  the first current-format private intent becomes the old-reader rollback floor.

## Verification

- Focused assistant continuity, notification authority, outbox runtime, session
  resolution, hosted callback tests, owning typechecks, docs drift, diff check,
  final ReviewGPT, GitHub CI, and current-base merge-tree proof.
Completed: 2026-08-11
