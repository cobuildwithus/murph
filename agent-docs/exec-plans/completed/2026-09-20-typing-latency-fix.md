# Prompt typing and retained canary diagnostics

Status: completed

## Outcome and owners

Give admitted direct Linq messages prompt typing feedback while the durable runtime
continuation starts or completes prior checkpoint work. Preserve canary diagnostic
rows across its authenticated reset, under existing bounded retention. Ordinary
account deletion must continue removing diagnostics and all conversation content.

The runtime already owns eligibility checks, input staging, and a bounded early
typing handoff for attachment preparation. Extend that same handoff to eligible
text inputs before checkpoint persistence completes. Keep runtime checkpoint
durability, provider admission, and reply ownership unchanged. Webhook admission
alone does not establish runtime assistant readiness or channel reply eligibility.

Account cleanup owns diagnostic deletion. Add a dedicated authenticated canary
entrypoint rather than allowing ordinary account-deletion callers to retain data.
Ingress traces must outlive mailbox deletion for this case; keep their logical
mailbox correlation and explicit ordinary-account deletion. The existing cleanup
receipt must preserve the runtime-log retention decision across retries.

## Proof and limits

- Hold checkpoint persistence and typing transport independently; show that
  accepted typing does not wait for checkpoint completion or model admission.
- Keep unconfigured, unauthorized-group, self-authored, and consumed paths quiet;
  keep duplicate typing sessions suppressed;
  retain failed-import cancellation and actual provider-acceptance timestamps.
- Reproduce canary reset removing account/mailbox content while retaining trace
  and runtime diagnostics; prove ordinary deletion still removes diagnostics.
- Run focused tests, PostgreSQL proof for relation/deletion changes, relevant
  typechecks, privacy/logging guards, and parent review before a scoped commit.
- No production deployment, production migration, or diagnostic repair is authorized.
  Historical platform and database wait subdivisions remain evidence limits.

## Result and review

- Ready: the composed runtime test holds the canonical checkpoint for a synthetic
  3.5 seconds. Typing is accepted before release; assistant admission still waits
  and takes the original handle without a second provider start. The same test
  fails on the prior attachment-only importer. Existing attachment handoff,
  cancellation, provider-failure, expiry, and authority tests remain green.
- Ready: text enqueue failure cancels unclaimed typing. Unconfigured assistants,
  self-authored inputs, consumed replays, and groups without route authority stay
  quiet. No prompt, model input, tool contract, or reply-selection code changed;
  deterministic runtime/provider-boundary proof owns this timing correction.
- Ready: canary and ordinary deletion exercise the same cleanup transaction with
  different explicit diagnostic policies. Canary logs survive failed vendor
  cleanup and retry; mismatched canary identities fail before account cleanup.
- PostgreSQL reproduced the original mailbox cascade using the actual initial
  trace migration, then proved the retention migration preserves the trace while
  removing mailbox content. Explicit diagnostic deletion still succeeds.
- Parent review found that dropping the cascade also requires fencing both
  trace-creation paths against ordinary account deletion. Each insert now locks
  the unsuspended member through the existing suspension fence. Four concurrent
  PostgreSQL cases cover both writers and both orderings. The unfenced producer
  fails the writer-first race proof; the final guarded producers pass.
- No new logging was needed in this continuation. The preceding checkpoint
  timing instrumentation remains on this branch. It measures a future slow
  transaction's acquisition, callback, completion, and bounded operation timings.

## Validation

- Runtime workspace-runner, conversation importer, channel activity, attachment
  typing, and typing-handoff suites passed. Runtime typecheck passed.
- Web account-data, cleanup, canary-reset suites: 150 tests passed.
- Web runtime-latency store suite: 40 tests passed.
- Local PostgreSQL schema/cascade and concurrent deletion proof: five cases passed.
  The entire migration chain also applied successfully to an empty isolated local
  task database. No production database was modified.
- Web typecheck, focused Web ESLint, complexity diff, logging guard, diff whitespace,
  and authored-content privacy review passed. Existing complexity hotspots did
  not grow.
- Changelog: updated, `2026-09-20/text-typing-starts-sooner`. The archive rendering
  suite passed ten tests. Content-only presentation uses the existing archive
  component; no visual or interaction changed. The local fragment has no source
  PR yet because this task has no PR. Assign its source when opening a PR.
- Existing Frog entries `20260911184822-documented-changelog-test` and
  `20260912202546-changelog-focused-test` cover the documented command's discovery
  failure. The repository-root Vitest command passed; no duplicate entry created.

## Rollout and evidence limits

Deploy guarded Web trace writers and drain old instances before dropping the
mailbox foreign key. Canary trace retention needs both the new reset path and
the migration. Deploy the runtime change separately through its normal release.
The already-merged Worker startup optimization remains relevant to initialization
latency; this patch does not duplicate it or promise a fixed platform tail.

The exact inner cause of the historical slow checkpoint remains unproven. Local
fault injection establishes the avoidable typing dependency, not a reproduction
of a production database connection or query stall. Deleted historical rows were
not recovered. Production efficacy still needs post-rollout observation.

Local implementation and parent review are complete. PR creation, pushed-head
CI, applicable final ReviewGPT, migration, and deployment remain outside this
task's current publication/production authority.
Updated: 2026-09-20
Completed: 2026-09-20
