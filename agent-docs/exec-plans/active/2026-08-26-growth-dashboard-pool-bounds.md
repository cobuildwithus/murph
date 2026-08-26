# Bound growth-dashboard database and crypto fanout

Status: active
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Keep the operator growth dashboard accurate while ensuring one page render
  cannot overrun the hosted Web database pool or start unbounded crypto work.

## Success criteria

- Rendering the growth page never captures or mutates the daily snapshot; the
  existing authenticated cron remains the sole snapshot mutation owner.
- Dashboard reads stay below the local fifteen-connection pool ceiling through
  the smallest owner-local grouping or sequencing.
- Retained group-message decryption reuses the existing set-based root metadata
  read and its concurrency-four KMS unwrap boundary.
- Focused metric, page-render, crypto-fanout, and typecheck proof pass; the
  candidate opens as a draft PR with its exact-head review gates started.

## Scope

- In scope: the hosted ops growth page, growth metric reads and retained-message
  decode path, focused tests, and owner documentation only if behavior changes
  materially.
- Out of scope: a new scheduler, cache, pool manager, dashboard service, queue,
  state machine, dependency, schema, or persisted state.

## Constraints

- Preserve every existing metric definition, snapshot retry, retention
  completeness signal, privacy boundary, and group-sender attribution rule.
- Prefer deletion and reuse: the cron owns daily mutation, and hosted crypto
  already owns batch metadata reads and bounded KMS unwraps.
- Keep the implementation separate from other database-pressure PRs and leave
  this PR draft and unmerged for parent review.

## Risks and mitigations

1. Risk: sequencing changes the time boundary used by related metrics.
   Mitigation: retain one `now` value and compare all calculated results in the
   focused suite.
2. Risk: batching payload decrypts changes ordering or error behavior.
   Mitigation: preserve input ordering, drain started decrypt work, and retain
   the existing fail-closed authenticity behavior.
3. Risk: removing page capture makes today's snapshot appear stale.
   Mitigation: keep the existing daily cron as the explicit mutation owner and
   keep live dashboard reads separate from snapshot history.

## Tasks

1. Independently validate the finding through a fresh ReviewGPT implementation
   thread and accept a patch only when it uses the existing owners.
2. Delete page-side snapshot mutation, bound database query groups, and batch
   retained-message root preparation without changing metric semantics.
3. Add focused page, fanout, and metric-correctness proof, then run app-local
   typecheck and scoped tests.
4. Inspect and commit the candidate, push it, open a draft PR, and start the
   required exact-head ReviewGPT and GitHub checks without marking it Ready.

## Decisions

- Treat the existing cron endpoint as the sole daily snapshot mutation owner.
- Reuse the hosted crypto set-based metadata and concurrency-four unwrap API;
  do not add a growth-specific concurrency utility when explicit grouping is
  sufficient.
- Preserve one read request's `now` across any sequential query groups so the
  dashboard still represents one coherent observation boundary.

## Verification

- Focused Vitest proof that a page render never captures a snapshot.
- More-than-fifteen retained messages/roots prove one set-based metadata read
  and no more than four concurrent root unwraps.
- Existing growth metric tests continue to prove values and completeness.
- Hosted Web typecheck, scoped lint when relevant, `git diff --check`, exact-head
  required CI, and required ReviewGPT gates.
