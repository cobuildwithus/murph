# Hosted foreground reply priority E2E gate

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Make the foreground-reply invariant executable at the hosted-local system
  boundary: after a real signed Linq inbound is durably accepted, Murph must
  deliver the corresponding reply promptly even when deterministic work,
  retention, a live turn, checkpoint publication, or stale runtime ownership
  is already contending for the member runtime.
- Permanently catch the PR 890 outage class in a dedicated CI check instead of
  relying on isolated controller tests or the broad hosted E2E aggregate.

## Success criteria

- A new hosted-local scenario starts the production Web, Temporal, Cloudflare
  Worker, UserRunner, RunnerContainer, and sandboxed assistant runtime graph.
- The scenario uses real HTTP/Temporal/runtime boundaries and contains no
  in-process mocks. Deterministic model and carrier servers remain only at the
  unsafe external network edges.
- The scenario proves a signed Linq inbound reaches one matching accepted
  outbound send below a deadline that is materially lower than the production
  180-second idle-checkpoint floor.
- The scenario deterministically exercises all runtime processing modes
  (`default`, `system_mailbox`, `inbox_media_retention`) plus active-turn,
  checkpoint-publication, pending-system-wake, and stale-owner contention.
- The system-mailbox probe seeds a representative wake storm covering every
  scheduler-owned system-work family and proves foreground preemption preserves
  durable system progress.
- The test fails on the proven PR 890 mode-mismatch behavior and on any
  transport boundary that strips the scheduler-selected processing mode.
- A stable, separately visible GitHub Actions job runs this scenario as its own
  CI gate.
- Focused tests, typechecks, the direct hosted-local scenario, canonical
  `test:diff`, and `verify:acceptance` pass.
- Required product-experience, preliminary specialist, final parent, CI, and
  final ReviewGPT gates are clean on the exact pushed PR head.

## Scope

- In scope:
  - New foreground-reply-priority hosted-local scenario and scenario registry
    coverage.
  - Test-only checkpoint barrier support needed to hold real runtime modes at
    deterministic production boundaries.
  - A dedicated hosted E2E CI job/check and current testing/verification docs.
  - The smallest proven runtime-contract correction if the new scenario exposes
    a still-open mode-transport defect on current `main`.
- Out of scope:
  - New scheduler, queue, persisted runtime state, retry manager, or AI-usage
    bypass.
  - Production latency telemetry/SLO changes.
  - Real carrier delivery or billable model calls in CI.
  - Broad refactors of the hosted-local harness or existing scenario files.

## Constraints

- Technical constraints:
  - Preserve the foreground-reply, exact-fence, mailbox durability, and
    product-critical-flow invariants.
  - Foreground `default` work must replace system-only/retention children only
    after exact abort and cleanup settle; waking a system-only child in place is
    not sufficient because it never enters the assistant phase.
  - Use one production-shaped stack and public/internal signed boundaries; test
    controls may pause real checkpoints but must not replace runtime behavior.
  - Keep the 180-second production idle floor active in the regression probe;
    do not shrink the bug away with test configuration.
  - Avoid edits owned by the active hosted-local stub-scoping and gate-env
    harness-hardening lanes.
- Product/process constraints:
  - Work in the isolated task worktree and preserve all unrelated ledger work.
  - Treat the existing processing-mode parser PR as evidence, not an invitation
    to duplicate architecture; reuse its minimal ownership correction only if
    the new end-to-end red proof requires it.
  - Use the PR lane, exact-head preliminary specialist pass, final ReviewGPT,
    and CI contract.

## Risks and mitigations

1. Risk: A timing-only test passes because background work finishes before the
   inbound arrives.
   Mitigation: pause the real checkpoint publication boundary and prove the
   selected processing mode reached it before sending the inbound.
2. Risk: Test-only behavior accidentally enters the production Worker graph.
   Mitigation: keep controls in the existing hosted-local test subclass/routes
   and extend the production-entrypoint exclusion test.
3. Risk: The gate becomes a slow combinatorial matrix.
   Mitigation: cover scheduler/runtime equivalence classes in one shared stack,
   with a compile-time/registry assertion for the closed wake-kind set.
4. Risk: A permissive deadline hides a return of the idle-floor bug.
   Mitigation: use a bounded per-probe deadline below the 180-second floor and
   report measured webhook-to-accepted-send latency in CI.
5. Risk: System work is dropped to make the reply fast.
   Mitigation: assert mailbox lag/checkpoint progress and preserved follow-up
   work after the foreground reply.

## Tasks

1. [x] Record the production incident cause and identify the exact red
   system-mailbox/foreground interleaving.
2. [x] Reuse deterministic hosted-local checkpoint holding for real
   system-mailbox/retention/default checkpoint paths, including abort-driven
   release.
3. [x] Build the new no-internal-mock foreground reply priority scenario and its wake/mode
   coverage matrix.
4. [x] Register the scenario and add a dedicated GitHub Actions check.
5. [x] Update current testing/verification docs with the gate contract and direct
   command.
6. [x] Capture the red result on current `main`; apply only the smallest root fix
   exposed by that proof.
7. [x] Run focused and direct hosted-local verification, then canonical checks.
8. [x] Complete the required local product, specialist, and parent review gates,
   close the plan, and produce the final pushed candidate. Exact-head final
   ReviewGPT and CI run after plan closure under the PR completion loop.

## Decisions

- Production evidence from the saved incident session is authoritative:
  durable mailbox acceptance and Temporal handoff were prompt; foreground
  `default` work was rejected behind an active `system_mailbox` fence and then
  waited for the three-minute idle-checkpoint horizon.
- The deployed repair in PR 967 correctly uses asymmetric exact
  abort-and-replace. The new gate tests that system property rather than a
  helper return value.
- "No mocks" means no mocked Temporal, Worker, Durable Object, container,
  checkpoint, mailbox, or delivery orchestration. Deterministic provider and
  Linq HTTP servers are required safety boundaries for non-billable,
  non-customer CI.
- The first full-stack red run exposed a second independent contract defect:
  assistant-runtime reconstructed a partial workspace invocation request and
  silently omitted `processingMode`. Delegating to the canonical hosted-
  execution parser is the smallest ownership correction and removes the
  duplicate parser.
- Import-only system work publishes its watermark through the canonical Web
  checkpoint path, while retention contention reaches the shutdown snapshot
  path. The existing hosted-local publication barrier now selects either real
  boundary without changing production state. A read-only hosted-local fence
  control proves the accepted foreground wake replaced the exact
  `system_mailbox` owner with a new `default` owner before the held commit is
  released; durable admission alone is not treated as preemption proof.
- Product-experience review is clean after tightening the all-wake fixture,
  causally scoping the active-turn response to its late inbound, and proving
  the exact system-to-default fence transition during held publication.
- Preliminary specialist ReviewGPT found one accepted coverage gap: the first
  matching Linq send ended duplicate observation too early. The returned
  test-only patch was rejected because it required global scheduler completion
  under the intentional 180-second idle floor. The landed correction instead
  holds exact matching-send counts after each existing terminal boundary, with
  a longer active-turn window that covers the deliberately stalled prior turn.
- The first acceptance run exposed that the workflow guard's closed scenario
  list did not include the new dedicated gate. The guard was updated, its
  focused suite passed, and the complete acceptance command then passed.

## Verification

- Commands to run:
  - Focused Vitest suites for changed test controls and scenario registry.
  - `pnpm hosted-local e2e foreground-reply-priority --profile e2e:stub`
  - `pnpm test:diff <changed paths>`
  - `pnpm verify:acceptance`
  - Exact-head GitHub Actions and ReviewGPT gates.
- Expected outcomes:
  - Each contention probe records one matching reply before its deadline, no
    duplicate matching send, and no lost durable mailbox work.
  - The dedicated `Hosted foreground reply priority E2E` check is terminal
    green.
- Direct hosted-local result, production 180-second idle floor:
  - `system_mailbox`: 18,813 ms
  - `inbox_media_retention`: 10,008 ms
  - stale invocation owner: 11,651 ms
  - active default turn: 11,551 ms
  - Each matching accepted-send count remained exactly one through its bounded
    post-boundary observation window.
- Canonical diff verification:
  - `pnpm test:diff <changed paths>` passed.
  - Assistant runtime: 1,892 passed, 2 skipped.
  - Hosted-local harness: 410 passed, 1 skipped; package boundary: 2 passed.
  - Hosted web: 6,712 passed, 174 skipped; lint, development smoke, and
    production build passed.
  - Cloudflare runner: 1,931 Node tests and 2 Workers-runtime tests passed.
  - `pnpm verify:acceptance` passed, including all workspace typechecks,
    package coverage, package boundaries, the production Web build, and
    Cloudflare Node and Workers-runtime suites.
Completed: 2026-07-26
