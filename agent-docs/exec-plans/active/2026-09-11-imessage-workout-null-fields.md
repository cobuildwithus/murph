# Restore Messages workout submission compatibility

Status: active
Created: 2026-09-11

## Outcome and protected contract

Outcome: Existing Messages clients can submit a workout with unfinished sets.
Reaches: Authenticated workout apply and snapshot requests with sparse presentation.
Proof: A synthetic request produced by the native Swift draft and encoder fails before the fix; route admission must normalize it to the unchanged shared contract.

## Design

The Messages Web ingress owns compatibility with installed native clients. Restore only absent nullable presentation fields before existing strict request validation. Preserve credential checks, access and consent gates, timestamps, mutation preconditions, unknown-field rejection, mailbox identity, and canonical runtime schemas. No new persistence, dependency, model call, or runner rollout is needed. A Web rollback restores the prior rejection but leaves normalized persisted requests readable.

## Work

- Add synthetic native-wire regression coverage for apply, snapshot, retry equivalence, and malformed input rejection.
- Normalize sparse presentation at the existing Messages validation boundary.
- Document the boundary and add a member-facing changelog fragment.
- Run focused tests, Web typecheck, native-wire proof, parent review, and applicable final review/CI.

## Evidence

- Native-wire apply and snapshot regressions failed before implementation and pass afterward.
- Four focused API/mailbox suites: 46 tests passed.
- Changed API/service and changelog rendering suites: 50 tests passed.
- Web typecheck passed after narrowing the validated exercises array at its guarded access.
- Parent walkthrough: sparse apply and snapshot requests normalize into the unchanged shared schema; malformed completed results and missing mutation preconditions fail closed; omitted/null retries admit identical envelopes. Patch UX Ready at this changed admission boundary.
- Complexity guard passed with zero hotspots. No awaited operation or provider input changed.
- Remaining completion: PR provenance, final review, exact-head CI. Production deployment and a member retry remain separate outcome proof.
- Private production evidence stays outside repository artifacts.
