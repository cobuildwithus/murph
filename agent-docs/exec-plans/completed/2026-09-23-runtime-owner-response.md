# Shorten runtime ownership responses

Status: completed
Created: 2026-09-23
Updated: 2026-09-23

## Outcome and invariant

Return committed runtime completion without waiting for its advisory recovery
hint, and avoid loading rare command dependencies for provider authorization.
Exact attempt/generation fencing, native-settlement release, callback auth,
upload obligations, and existing typing placement remain unchanged.

## Owner and evidence

The Web ownership controller commits Postgres state. Its authenticated HTTP
route owns response lifetime; Next `after` already owns post-response work in
adjacent routes. Completion currently awaits the two-second advisory Temporal
hint after commit, delaying the Worker's completion acknowledgement. Static
imports also pull recovery and legacy materialization into provider authorization.
The only other production controller caller is voice reconciliation.

## Smallest correction

Move the hint to the route's existing framework lifecycle after successful
completion. Import the hint there and rare legacy/upload helpers in their
command branches. Keep the current notification timeout and accepted-attempt
recheck as recovery owners. Add no queue, state, protocol, dependency, scheduler,
or retry mechanism. Leave backend pre-read removal out: it would broaden the
authorization transaction contract for an unmeasured gain.

## Failure and deployment

Authentication, validation, and database errors cannot schedule hints. Stale
completion cannot signal a successor. Early completion still retains the fence;
settled completion releases only the exact native target. A lost deferred hint
converges through the existing accepted-attempt recheck. Old and new Workers
receive the same wire response; Web can deploy or roll back independently.

## Product UX patch

- Outcome: reduce avoidable waiting between conversation turns.
- Reaches: existing hosted conversation runtime completion and authorization.
- Proof: route ordering and rejection scenarios, existing notification timeout
  tests, Postgres completion/replay tests, and dependency loading assertions.

## Tasks

1. Apply lazy imports and defer only successful completion hints.
2. Verify route ordering, auth/validation/stale failures, dependency loading,
   completion persistence/replay, existing timeout recovery, and Web typecheck.
3. Update owner contract and changelog; review complexity and the complete diff.
4. Push draft PR, finish exact-head CI and required ReviewGPT.

## Verification

- Focused route, notification, isolated Postgres ownership, and changelog tests:
  77 passed on the updated main base.
- Web typecheck passed after adapting the test latch to the existing ES library.
- Provider dependency regression fails against the original controller.
- In-memory esbuild ESM split probe: eager graph 2,552,540 to 635,500 bytes;
  no eager Temporal client. This measures dependency shape, not production latency.
- Web ESLint and complexity guard pass against main; no source hotspots above 20.
- Parent review: durable writes and exact identity remain the only success
  authority; HTTP response lifetime is the sole deferred-effect owner.
- Product UX: Ready for this bounded timing patch; no new visible state or input.
- Implementation and public release note complete in PR #3681. Required
  ReviewGPT and exact-head CI results are recorded on the PR.
Completed: 2026-09-23
