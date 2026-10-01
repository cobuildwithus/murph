# Device-sync wake convergence

Status: active
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Make retained hosted device-sync dirty work converge without provider-cadence work repeatedly consuming its local admission budget or a redundant runtime wake repeatedly deferring its post-pass record.

## Success criteria

- A webhook-dirty wake does not start provider cadence before fetching its pending dirty payload.
- A retained dirty-remainder wake does not run the provider scheduler before dirty payload admission.
- A staged single or batch dirty-processed record finishes across a coalesced runtime wake when canonical mailbox high waters prove that wake redundant.
- New conversation input, unseen mailbox work, an incomplete mailbox read, or a wake during exact dirty acknowledgement still preempts the record.
- Focused runtime tests prove both the initial webhook and retained continuation preserve dirty-payload admission.
- Package typecheck and required exact-head PR checks pass.
- Hosted integration no longer leaves the device-sync mailbox item pending.

## Scope

- In scope: hosted runtime device-sync scheduler admission, post-pass wake revalidation, and focused regression coverage.
- Out of scope: provider scheduling policy, Web dirty-state ownership, and unrelated runtime orchestration changes.

## Constraints

- Technical constraints: preserve exact dirty-payload acknowledgement and retry ownership; do not drop provider work or weaken the 100-job bound.
- Product/process constraints: keep foreground work prioritized, retain existing device connections, and use the PR review and deployment gates.

## Risks and mitigations

1. Risk: skipping a scheduler pass could delay legitimate provider cadence.
   Mitigation: skip only webhook-dirty work and runtime-authored dirty-remainder retries; connection and scheduled-reconcile wakes keep the existing cadence owner.
2. Risk: clearing retry state could acknowledge unprocessed data.
   Mitigation: leave dirty-state fetch, local job completion, and post-checkpoint acknowledgement unchanged.
3. Risk: consuming a real foreground wake could delay a member reply or newer system work.
   Mitigation: consume only a pending wake whose canonical conversation and system mailbox prefetch is complete and caught up to every lane high water; preserve checkpoint-reported conversation input and any uninspectable wake as preemption.

## Tasks

1. Completed: added failing scheduler-admission regressions for webhook-dirty and retained dirty-remainder wakes.
2. Completed: corrected the scheduler gate at the hosted runtime owner.
3. Completed: added production-entrypoint proof that webhook dirty work reaches terminal mailbox acknowledgement without starting provider cadence.
4. Completed: reproduced the hosted post-pass race in the production-like Junction replay and proved that provider work completed while a wake arriving after preparation checkpoint deferred its exact dirty-processed record.
5. Completed: revalidate recorded device-sync wakes against canonical mailbox high waters while preserving conversation, unseen-mailbox, active-projection, and exact-ack interruption priority.
6. Completed locally: ran the 74-test focused runtime suite, package typecheck, clean runner bundle assembly, and all eight hosted Junction replay scenarios.
7. Completed: added the public member-facing recovery note.
8. Remaining: exact-head PR review, merge, deploy, and production convergence proof.

## Decisions

- Treat webhook-dirty and runtime-authored dirty-remainder wakes as dirty-import work, not new provider-cadence signals.
- Treat a runtime wake observed after device-sync provider mutation as a hint to re-read canonical mailbox high waters, not by itself as proof of newer work. Only a complete caught-up read permits the already-staged record to finish.

## Product UX

- Effort: Patch.
- Outcome: existing connected-device imports finish and can produce their already-promised downstream result instead of waiting behind repeated cadence work.
- Reaches: the existing provider-webhook journey when the account's bounded local queue was full on the first dirty-state pass.
- Proof: the scheduler-admission regression changed from failing to passing, the production entrypoint reaches terminal acknowledgement without a provider request, and all eight hosted Junction replay scenarios reach terminal mailbox acknowledgement.

## Product UX walkthrough

- Person and path: an existing member whose connected wearable sends a replayed activity payload while scheduled provider work fills the local pass budget.
- Expected experience: retained payload pages drain through bounded continuation passes without provider cadence refilling the local queue ahead of each page, then reach terminal acknowledgement and the existing downstream automation.
- Recovery: provider cadence stays Web-owned and resumes after retained imports drain and the existing completion fence publishes it; one or more bounded continuation passes can run first. No data, connection, or retry authority is dropped.
- Result: Pass locally. All eight hosted Junction replay scenarios reached terminal acknowledgement; exact-head review, CI, deployment, and production observation remain.

## Verification

- Passed: focused 74-test system-mailbox and preemption suite, assistant-runtime typecheck, clean production runner-bundle assembly at 11,592,493 bytes, and all eight hosted Junction wearable direct-resource replay scenarios.
- Remaining gates: documentation checks, exact-head PR CI and ReviewGPT, merge, deployment, and production convergence proof.
