# Preserve ordinary retries after cold-history deferrals

Status: active

## Outcome and owner

Cold-history deferrals must leave the existing bounded transport retry allowance
at the SQLite job failure owner. Reuse the validation budget refresh; no new
state, retry mechanism, authority or acknowledgement policy. Reader ships first,
then the unchanged thaw-capable producer rebases onto it. No push authorized.

## Proof and progress

- At reader `371635e706`, the extended service regression fails: a token error
  after five cold failures makes the job dead. The new hosted regression fails:
  after six cold failures, a warm reopen and cold wake handoff, the next token
  error promotes the unpublished payload ID for acknowledgement.
- With the store predicate expanded to the exact cold error code, both focused
  tests pass unchanged. Hosted success imports a real WHOOP sleep snapshot,
  reads the canonical event ledger, and acknowledges only after publication.
- Extend validation restart tests with cold/validation/cold interleaving.
- Verify both branches, audit adjacent failure boundaries, commit reader and
  rebase producer. Record commands/counts and final rollback floor below.

Internal rollout correction; no separate public changelog for the unshipped
cold-storage feature. Parent owns PR review; local work does not push.

## Reader verification

Both regressions failed at `371635e706` and passed after the store-only fix:

```sh
pnpm --filter @murphai/device-syncd exec vitest run test/service.test.ts -t 'cold history unavailability retains' --no-coverage
pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-device-sync-runtime.test.ts -t 'cold history deferrals preserve' --no-coverage
```

Each: 1 failed before, 1 passed after (201 and 162 unrelated tests skipped).
The hosted fixture's ack response was then completed for typecheck; no behavioral
assertions changed, and the focused regression was rerun successfully.

```sh
pnpm --filter @murphai/core --filter @murphai/device-syncd --filter @murphai/assistant-runtime build
pnpm --filter @murphai/device-syncd build
pnpm --filter @murphai/core --filter @murphai/device-syncd --filter @murphai/assistant-runtime typecheck
pnpm --filter @murphai/assistant-runtime typecheck
pnpm --filter @murphai/device-syncd exec vitest run test/service.test.ts test/store.test.ts --no-coverage
pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-device-sync-runtime.test.ts test/device-sync-service.test.ts test/hosted-runtime-cold-ingests.test.ts test/hosted-runtime-workspace-runner.test.ts --no-coverage
pnpm --filter @murphai/core exec vitest run test/integration-ingest-cold-storage.test.ts --no-coverage
pnpm complexity:diff --base 371635e706
```

Builds PASS; packages built before Vitest. Typecheck initially failed only on the
new test response's missing fields, corrected; all three package typechecks now
PASS. Device-syncd: 268 tests / 2 files (service 202, store 66); assistant-runtime:
338 / 4; core: 2 / 1. Total **608 / 7**. Complexity PASS, source maximum remains
18 and no added debt. Output redaction pipes are omitted from commands above.

## Adversarial review

- Validation/cold/validation/cold interleaving: four existing service restart
  regressions now compose both deferrals; the ordinary transport error still
  consumes one of five attempts. Permanent errors and ordinary exhaustion remain
  covered by the existing bounded-validation and service tests.
- Warm reopen and hosted cold wake reconstruction: the new composed test proves
  persisted remaining allowance, payload relinking, no early acknowledgement,
  and canonical publication before successful acknowledgement.
- Lease expiry: ordinary crash attempts still consume the bounded budget. The
  failure SQL retains lease-owner/expiry predicates; it cannot mutate a reclaimed
  job. Repeated crashes or ordinary errors can still exhaust the normal allowance;
  this change does not grant unlimited retries to unrelated failures.
- Account reconnect/disconnect: the service checks connection revision and
  disconnect generation before its failure transition and before canonical
  effects. Superseded execution releases rather than records its stale failure.
  Explicit disconnect and permanent failures keep their existing terminal policy.
- Producer thaw: verified bytes precede atomic reference detachment under the
  canonical lock; remote ciphertext is immutable. A failed materialization or
  detachment remains the typed retryable error. Append receipts retain the
  existing base/hash replay checks. Existing missing/corrupt and successful thaw
  tests will run again after rebase.

No additional out-of-policy dead-and-ack path was proven; no speculative source
changes made. The refreshed ordinary retry budget is deliberately bounded.
