# Safe rollout of the shared runtime idle policy

Status: completed
Created: 2026-09-17
Updated: 2026-09-17

## Goal

Resolve the accepted ReviewGPT rollout finding for PR #3536 while retaining one
normal ten-minute quiet policy and no additional timer or deployment state.

## Cause and design

Staging activates a new Worker before serving-image admission. Sending the longer
value through the old checkpoint field can therefore reach a runtime without the
Ask deadline correction, including after an interrupted artifact smoke.
Retire that optional field and send `runnerIdleTtlMs`. Old readers ignore unknown
fields and keep their legacy default; new readers use the shared ten-minute
default and contain the Ask correction. The retired field must not be dual-written.
Use the same policy name through existing runtime consumers and test fixtures.
No deployment sequence, persisted state, fallback flag, or dependency is added.

## Tasks and success criteria

1. Replace the old request field and migrate its direct consumers and fixtures.
2. Prove mixed-version parsing and actual old-reader fallback behavior.
3. Verify composed follow-up residency, Ask ordering, producer output, and types.
4. Update protocol ownership, review the diff, and commit the remediation.
5. Start ReviewGPT round two on the pushed head concurrently with CI; finish with
   a green, mergeable PR. Production deployment remains outside this task.

## Evidence

- Actual base parser and checkpoint resolver replay: old runtime/new Worker keeps
  180,000 ms; new runtime with either Worker uses 600,000 ms. Both same-version
  combinations pass. Evidence remains in ignored scratch output.
- Contract parser: 42 tests passed, including retired-field and invalid-TTL cases.
- Cloudflare: 369 tests passed across alarm/preparation, invocation transport,
  container identity, supervised invocation, and fleet lifecycle. The actual
  producer request contains runner TTL and omits the retired field.
- Hosted execution, assistant runtime, and Cloudflare typechecks passed.
- Complexity guard passed with no added hotspot debt. Mechanical rename audited
  separately from the four files containing new assertions or protocol comments.
- Runtime: all 225 focused tests passed across causal input, collapse, checkpoint
  publication, provider cleanup, maintenance, and metadata timing. The legacy
  request fixture explicitly omits its harness override; the two timing suites
  passed their isolated 65-test rerun after contention in the initial parallel run.
- Documentation drift and whitespace checks passed. Remaining remote gates are
  ReviewGPT round two, CI on the new pushed head, and final mergeability proof.

## Risks

Only updated runtimes adopt ten minutes during a staged release. Old runtimes
keep their existing behavior until replaced; an interrupted release remains safe.
The existing Ask validity and checkpoint-before-effect rules remain authoritative.
No rollback or production mutation is performed.
Completed: 2026-09-17
