# Reduce startup retries and diagnose warm message latency

Status: completed
Created: 2026-09-17
Updated: 2026-09-17

## Goal and scope

Reinvestigate the three delegated findings, fix reproduced startup and duplicate
maintenance wake defects, and close causal timing gaps without bypassing runtime
authority. Production investigation is read-only; publication and deployment are
outside this local task. The earlier instant-reply alert fix remains a separate
branch.

## Proven causes and changes

- Empty-source migration advanced one section per ensure request and activated on
  a later request. Drain the four finite sections and activate under the existing
  shared command budget. Canonical receipts, exact source freeze and activation
  remain mandatory. A lost acknowledgement resumes from the receipt.
- In the private Temporal owner, identical system pointers could cancel a
  confirmed default owner's wait. Coalesce only the exact pointer admitted before
  the Activity, within the original accepted horizon. Version the command change
  with a Temporal patch. New pointers, conversations, admission races, failed
  admission, release and expiry preserve recovery.
- Historical request spans locate warm delays in the mailbox Web fetch and
  canonical owner launch binding. They do not identify a safe removable operation
  inside Web. Add numeric prefetch and preparation subdivisions and whole-wake
  retry counts/wait time; preserve execution ordering and required owner checks.
- Postgres ensure returned before the legacy processing-summary owner. Reuse its
  detached summary writer, retain safe correlation, and record finite retry
  reasons. Legacy delegation keeps its existing single writer.

No private rows, message content, production identifiers or exact incident
chronology are retained in this plan or fixtures.

## Product UX

Ready for local implementation review: a new account with a frozen empty source
needs one retry before admission instead of five. Nonempty sources retain their
bounded migration path. Lost acknowledgements and deadline expiry stop safely
and resume; an unfrozen source never activates. A confirmed owner receives fewer
redundant maintenance wakes, while new conversations and recovery remain live.
No prompt, tool choice, assistant reply, permission or routing contract changes;
deterministic scheduling and replay evidence owns these boundaries, so a live
model journey is not applicable.

## Architecture and rollout

Reuse canonical migration receipts, command budgets, processing summaries, strict
timing schemas and the existing Temporal accepted-owner horizon. No new store,
queue, dependency or authoritative state. New optional timing consumers must
precede producers because old readers reject unknown fields. The private patch
retains historical command replay. This work adds no foreground network calls;
summary transport runs after processing without delaying the response.

## Verification

- Migration/source/admission suites: 41 passing cases, including one-retry startup,
  no-progress rejection, lost import acknowledgement and shared deadline expiry.
- Postgres summary route: 4 passing cases; legacy summary/fingerprint/lifetime
  subset: 13 passing cases.
- Web direct wake and changelog: 31 passing cases. Failed later requests do not
  preserve stale timing; retry time remains separately visible.
- Strict timing parser: 41 passing cases. Both controlled producer-delay checks
  pass, covering stale input replacement and attribution without changing ordering.
- Composed SQLite/Postgres migration: 18 passing cases after applying the complete
  schema to an isolated loopback test database. Exact import receipts and activation
  complete in one call, without enrolling another baseline source.
- Cloudflare, assistant-runtime, hosted-execution and Web typechecks pass.
  Changed Web ESLint, docs drift and diff checks pass. `pnpm complexity:diff` passes
  with unchanged complexity debt; existing large runtime owners are outside this
  bounded change. Timing projection helpers avoid adding branches to those owners.
- Private workflow/replay suites: 448 passing cases. Native old-history replay
  passes the versioned patch and rejects a forced unversioned behavior change.
  Required private `pnpm verify` passes, including coverage, deployment tests,
  production build and built-worker checks. Private implementation commit: `de714d7`.

## Completion evidence

Parent review checks privacy, exact-source and execution ownership, request
budgets, retry recovery, Temporal replay and measurement scope. Changelog copy is
prepared as `new-account-startup-waits`; add source PR provenance when publishing
(the local task has no PR number). Existing Frog entries already cover the
repository-root Vitest command issue; no duplicate entry is needed.

External ReviewGPT, exact-head CI and production rollout remain future gates if
these local commits are published. No production latency improvement is claimed
before deployment and subsequent observation.
Completed: 2026-09-17
