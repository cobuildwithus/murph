# Device-sync wake convergence

Status: active
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Make retained hosted device-sync dirty work converge without provider-cadence work repeatedly consuming its local admission budget.

## Success criteria

- A retained dirty-remainder wake does not run the provider scheduler before dirty payload admission.
- Focused runtime tests prove the retained wake can use the next pass's admission budget.
- Package typecheck and required exact-head PR checks pass.
- Hosted integration no longer leaves the device-sync mailbox item pending.

## Scope

- In scope: hosted runtime device-sync scheduler admission and focused regression coverage.
- Out of scope: provider scheduling policy, Web dirty-state ownership, and unrelated runtime orchestration changes.

## Constraints

- Technical constraints: preserve exact dirty-payload acknowledgement and retry ownership; do not drop provider work or weaken the 100-job bound.
- Product/process constraints: keep foreground work prioritized, retain existing device connections, and use the PR review and deployment gates.

## Risks and mitigations

1. Risk: skipping a scheduler pass could delay legitimate provider cadence.
   Mitigation: skip only the runtime-authored dirty-remainder retry; the original connection wake and canonical next-reconcile owner remain unchanged.
2. Risk: clearing retry state could acknowledge unprocessed data.
   Mitigation: leave dirty-state fetch, local job completion, and post-checkpoint acknowledgement unchanged.

## Tasks

1. Completed: added a failing scheduler-admission regression for the retained dirty-remainder wake.
2. Completed: corrected the scheduler gate at the hosted runtime owner.
3. Completed locally: ran focused tests, package typecheck, build, and documentation checks.
4. Completed: added the public member-facing recovery note.
5. Remaining: exact-head PR review, merge, deploy, and hosted runtime convergence proof.

## Decisions

- Treat the runtime-authored dirty-remainder wake as continuation work, not a new provider-cadence signal.

## Product UX

- Effort: Patch.
- Outcome: existing connected-device imports finish and can produce their already-promised downstream result instead of waiting behind repeated cadence work.
- Reaches: the existing provider-webhook journey when the account's bounded local queue was full on the first dirty-state pass.
- Proof: the scheduler-admission regression changed from failing to passing; the hosted Junction integration remains the final end-to-end gate.

## Product UX walkthrough

- Person and path: an existing member whose connected wearable sends a replayed activity payload while scheduled provider work fills the local pass budget.
- Expected experience: the payload is retained, admitted on the next pass, terminally acknowledged, and the existing downstream automation proceeds without repeated runtime starts.
- Recovery: provider cadence stays Web-owned and is published after the existing completion fence; no data, connection, or retry authority is dropped.
- Result: Ready for candidate review; merge remains gated on the hosted Junction end-to-end proof.

## Verification

- Passed: focused assistant-runtime test (118 tests), assistant-runtime typecheck, assistant-runtime build, docs drift, and docs gardening.
- Remaining gates: PR CI, ReviewGPT, hosted integration, and production convergence proof.
