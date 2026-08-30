# Device-sync wake convergence

Status: active
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Make retained hosted device-sync dirty work converge without provider-cadence work repeatedly consuming its local admission budget.

## Success criteria

- A webhook-dirty wake does not start provider cadence before fetching its pending dirty payload.
- A retained dirty-remainder wake does not run the provider scheduler before dirty payload admission.
- Focused runtime tests prove both the initial webhook and retained continuation preserve dirty-payload admission.
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
   Mitigation: skip only webhook-dirty work and runtime-authored dirty-remainder retries; connection and scheduled-reconcile wakes keep the existing cadence owner.
2. Risk: clearing retry state could acknowledge unprocessed data.
   Mitigation: leave dirty-state fetch, local job completion, and post-checkpoint acknowledgement unchanged.

## Tasks

1. Completed: added failing scheduler-admission regressions for webhook-dirty and retained dirty-remainder wakes.
2. Completed: corrected the scheduler gate at the hosted runtime owner.
3. Completed: added production-entrypoint proof that webhook dirty work reaches terminal mailbox acknowledgement without starting provider cadence.
4. Completed locally: ran focused tests, package typecheck, build, and documentation checks.
5. Completed: added the public member-facing recovery note.
6. Remaining: exact-head PR review, merge, deploy, and hosted runtime convergence proof.

## Decisions

- Treat webhook-dirty and runtime-authored dirty-remainder wakes as dirty-import work, not new provider-cadence signals.

## Product UX

- Effort: Patch.
- Outcome: existing connected-device imports finish and can produce their already-promised downstream result instead of waiting behind repeated cadence work.
- Reaches: the existing provider-webhook journey when the account's bounded local queue was full on the first dirty-state pass.
- Proof: the scheduler-admission regression changed from failing to passing, and the production entrypoint reaches terminal acknowledgement without a provider request; the hosted Junction integration remains the final end-to-end gate.

## Product UX walkthrough

- Person and path: an existing member whose connected wearable sends a replayed activity payload while scheduled provider work fills the local pass budget.
- Expected experience: retained payload pages drain through bounded continuation passes without provider cadence refilling the local queue ahead of each page, then reach terminal acknowledgement and the existing downstream automation.
- Recovery: provider cadence stays Web-owned and resumes after retained imports drain and the existing completion fence publishes it; one or more bounded continuation passes can run first. No data, connection, or retry authority is dropped.
- Result: Hold until the hosted Junction end-to-end proof reaches terminal acknowledgement.

## Verification

- Passed: focused assistant-runtime tests (118 runtime tests and 44 production-entrypoint tests), assistant-runtime typecheck, assistant-runtime build, docs drift, and docs gardening.
- Remaining gates: PR CI, ReviewGPT, hosted integration, and production convergence proof.
