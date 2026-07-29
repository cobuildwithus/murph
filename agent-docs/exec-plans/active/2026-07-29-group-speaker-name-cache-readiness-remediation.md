# Prevent provisional speaker-name cache decisions

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Ensure the longer-lived speaker-name cache consumes only fully materialized
  profile snapshots and only exact phone handles actually checked by the
  bounded owner-contact lookup.

## Success criteria

- A granted profile-name share with a null snapshot returns the existing
  unavailable result and creates no positive or negative cache entry.
- Contact misses are emitted only for the exact bounded phone list submitted to
  the owner-contact reader; overflow handles remain operation-local.
- Focused Web/runtime tests, affected typechecks, final ReviewGPT, exact-head
  CI, and merge-conflict proof pass.

## Scope

- In scope: profile-snapshot readiness classification, bounded contact-miss
  evidence, direct tests, and the matching live documentation.
- Out of scope: invalidation, retries, queues, migrations, new state owners,
  wider contact lookup bounds, or participant-effect behavior.

## Decision

- Reuse the existing unavailable and next-operation recovery path. Add no
  readiness state machine or cache invalidation mechanism.

## Progress

- Null profile snapshots now return `participant_names_unavailable`; the
  existing Web handler does not call owner contacts after that result, and the
  runtime's unavailable-result regression proves no cache file is written
  before a fresh operation resolves the profile.
- Web now slices the exact contact-lookup input to 16 handles and emits labels
  or misses only for that slice. A 17-handle regression proves overflow is
  absent from miss evidence and resolves normally when requested later.
- Focused Web proof passes 136 tests and the Web typecheck.
