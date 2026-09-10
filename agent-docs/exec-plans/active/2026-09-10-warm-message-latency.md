# Simplify the warm conversation critical path

Status: active
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Explain and reproduce warm conversation latency, then remove demonstrated unnecessary work before typing and provider execution.

## Success criteria

- Account for existing ingress, import, preparation, and typing milestones without summing overlapping spans or treating cross-host clocks as exact.
- Reproduce the responsible operations with synthetic inputs and compare the same workload before and after any correction.
- Preserve durable acceptance, exact member/write-fence authority, duplicate suppression, current audience, and quiet paths.
- Focused tests, relevant typechecks, complexity review, and applicable completion gates pass.

## Scope

- In scope: the existing Web wake handoff, Worker mailbox transport, runtime import, and foreground preparation owners.
- Out of scope: new caches, queues, services, schedulers, model changes, resource resizing, or speculative cold-start redesign.

## Constraints

- Keep keys and signing authority outside the container; canonical mailbox ordering stays Web-owned.
- No private identifiers, production rows, or transcripts in artifacts. Reproduction uses synthetic messages and data.
- Outcome: faster useful response through less work, with unchanged delivery and authority semantics.
- Reaches: ordinary warm direct conversations, duplicates, active-turn arrivals, and denied/stale authority.
- Proof: focused production-owner tests and synthetic timing/call-count reproduction; distinguish local results from production improvement.

## Risks and mitigations

1. Removing an apparent duplicate may erase a real authority or recovery boundary. Trace the current owner and prove rejection/recovery before deleting it.
2. Aggregate timing can hide overlapping work or machine clock skew. Use causal identities and same-clock spans; label unattributed residuals.

## Tasks

1. Map existing milestones to individual calls, local work, and ownership boundaries.
2. Reproduce the largest removable work using existing test/harness entrypoints.
3. Choose the smallest proven correction, prioritizing deletion or removing an unnecessary ordering dependency.
4. Compare focused before/after proof, review the diff and privacy, and complete the scoped change through the repository workflow.

## Decisions

- Existing traces establish a serial dependency between current-access validation, Temporal acknowledgement, and the payloadless direct wake. The mailbox is already committed; acknowledgement does not grant additional processing authority.
- Remove that ordering dependency at the existing signal owner: start the optional direct wake after validation and signal dispatch, then continue awaiting durable acknowledgement before webhook success.
- Retain the existing retry and duplicate-consumption owners. No new service, cache, persisted state, wire field, or runtime protocol version.
- Do not combine mailbox fetch and Worker-only decode in this patch. That would change the shared payload/sidecar contract and deployed runner compatibility; an extra cache or dual decode mode would add complexity. Existing typed spans do not isolate every database query inside the fetch.
- Do not remove causal system-mailbox processing, cross-session context, or write-fence checks without proof that their current product/authority work is redundant.
- No new production instrumentation, model changes, or early cosmetic typing. Typing acceptance already overlaps model execution.

## Verification

- Reproduction: a new regression fails on the base because no hint starts while acknowledgement is pending. The fixed production signal owner passes; a fake-clock scenario retains an 80ms access check but removes a 250ms acknowledgement from hint latency (330ms before, 80ms after).
- Product UX: Patch / Ready for candidate review. Ordinary eligible Linq messages start the existing hint sooner. Inactive, wrong-owner, participant-denied, and cancelled access paths never start it. Signal failure still fails webhook acknowledgement and retains provider retry. Other channels and missing-checkpoint fallback retain their prior ordering.
- Existing mailbox import and Worker decode/fetch tests pass (69 and 12 cases). Focused Web signal, handoff, mailbox-wake, and webhook idempotency tests cover delivery and authority boundaries.
- Focused Web proof: 91 cases pass across signal, direct wake, mailbox wake, and webhook idempotency suites. One stale mock argument assertion was corrected and its 19-case suite rerun green. Web typecheck passes. Complexity passes with no hotspots; handoff maximum drops from 12 to 11.
- Content-only changelog rendering passes (10 cases) after generating the ignored fragment module. PR #3155 is draft; final CI and external review remain pending.
- Existing production timing is diagnostic evidence only; no post-change production speedup is claimed without a live measurement.
