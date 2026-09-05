# Commit bounded reconnect classification progress

Status: active
Created: 2026-09-05
Updated: 2026-09-05

## Outcome and cause

Reconnect must make durable progress through more than 800 legacy nullable
payload classifications without advancing credentials, connection epoch or the
OAuth claim until all payloads are classified. The current classification limit
throws inside the upsert transaction, rolling back its own annotations. The
existing retry therefore repeats the same work forever for a large backlog.

## Smallest correction

The existing dirty-state owner returns classification_pending instead of
throwing inside the transaction. Run it before connection credential preparation
and updates. Return from the transaction to commit annotations, then throw the
existing retryable error outside it. Reuse the existing two-attempt retry owner.
No new persisted state, queue, retry loop, dependency or unbounded work.

Authority remains member, consent, connection and dirty-marker locks in their
existing order. Only classification annotations may commit on a pending pass;
current credentials, epoch, dirty counters, payloads and callback claim remain
unchanged. Every retry revalidates current authority. The existing bounded
legacy decrypt exception remains at most 800 rows per pass; this patch does not
expand external work under locks or change the steady-state path.

## Product UX

Patch. Reaches existing device reconnect/recovery. Proof covers a backlog above
one pass and above the whole request budget, plus consent rejection and retained
credential-independent evidence. Existing failure codes remain unchanged.

## Verification

Focused OAuth-connection and dirty-store tests; real PostgreSQL upsert with 801
and 1601 legacy rows; verify progress survives a retryable return while sensitive
state remains unchanged. Typecheck, lint, complexity/diff/privacy review, then
scoped commit, PR, ReviewGPT concurrent with CI.

## Candidate proof

- Both new full-store PostgreSQL regressions fail on the original source: 801 rows never completes, and all 1601 rows remain nullable after the request budget. The corrected source passes both.
- 89 focused OAuth-connection, dirty-store, reconnect progress and retention tests pass, plus four consent/acknowledgement PostgreSQL scenarios.
- Web typecheck passes after generating public workspace service declarations; scoped ESLint and diff/privacy checks pass. Complexity debt decreases by two in the connection owner; dirty-store debt is unchanged.
- The unrelated build-memory assertion now matches the existing 6144 MiB production policy; its migration guard suite passes.
- Changelog and final PR review/CI remain before completion.
