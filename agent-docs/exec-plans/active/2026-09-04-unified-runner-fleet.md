# Unified global runner fleet and configurable warm inventory

Status: active
Created: 2026-09-04
Updated: 2026-09-05

## Goal

Make warm inventory an allocation optimization within one globally eligible member execution fleet. Preserve the existing member execution owner, immutable container binding, encrypted workspace, and write-fence contracts while removing split capacity and lifecycle branches.

## Success criteria

- All fresh member allocations use the same container namespace and lifecycle, whether prewarmed or cold and whether foreground or background.
- Configurable ready inventory defaults to two; simultaneous foreground requests can claim distinct ready targets atomically.
- Background-only work never claims fresh ready inventory, but can reuse its member-owned container.
- New containers are globally eligible; legacy ENAM bindings remain exact during migration.
- Unknown binding or retirement outcomes retain the exact pending target. No used target returns to shared inventory.
- One declared fleet capacity budget includes transient legacy drain capacity; migration cannot silently increase account demand or strand stored references.
- Focused concurrency/lifecycle/config tests and relevant typechecks pass. Obsolete source paths are removed when safely superseded.

## Product UX

Effort: Patch; improve the existing foreground-start promise without changing reply content or delivery authority.
Outcome: Two foreground conversations can receive ready slots concurrently, with one shared capacity and execution lifecycle.
Reaches: New foreground starts, background-only device sync, same-member warm reuse, and legacy-bound members recovering across deployment.
Proof: Coordinator concurrency tests plus real controller/binding tests; focused hosted-local foreground/background proof where available. Production latency and capacity claims require the later authorized rollout.

## Ownership and scope

- UserRunner owns member execution admission, pending target, write fence, workspace publication, and successor creation.
- Container Durable Object owns immutable binding and native lifecycle. Inventory coordinator owns only pristine slots and opaque abandoned-handoff cleanup.
- ReviewGPT A: shared lifecycle/identity, binding guards, controller/invocation/wake/state store, focused identity tests.
- ReviewGPT B: inventory coordinator, scheduler/bootstrap, bounded maintenance, coordinator tests.
- ReviewGPT C: deployment capacity/placement, environment contracts, hosted-local configuration and focused config tests.
- Parent: reconcile shared contracts, inspect returned patches, cross-repository deploy forwarding, owner documentation, complete verification and candidate review.
- Production deployment, live capacity changes, and destructive namespace deletion are separate from implementing and verifying the migration.

## Design decisions

- Existing RUNNER_CONTAINER handles all new opaque targets. Legacy standby names retain their original namespace for exact recovery and retirement.
- New opaque names use runner--v-<release>--<random>; legacy standby--v-* is never reinterpreted in the new namespace.
- New target region identity is GLOBAL; old ENAM identity is preserved only for legacy recovery. No hard location pin for new execution.
- HOSTED_EXECUTION_STANDBY_TARGET defaults to two and has a strict bounded range. Existing off/shadow/allocate modes control only ready inventory, never select a different fresh cold lifecycle.
- Prefer shared implementation and removal of origin-dependent execution branching over new services, leases, schedulers, or accounting registries.
- Keep scope-justified compatibility until live and dormant references can drain; specify terminal removal and rollback floor explicitly.

## Risks and mitigations

- Lost bind/cleanup results: persist the exact target before ambiguous work, require exact terminal retirement before clearing, and test delayed results.
- Inventory depletion: bounded parallel fill, staggered reproof, coalesced maintenance, bounded indexed cleanup and durable recovery before external work.
- Migration skew: retain original namespace readers and exact binding identity; verify Worker/image and schema compatibility and explicit drain conditions.
- Capacity saturation: conserve declared total through migration; speculative prewarm is best-effort and cannot reclaim member-owned targets.
- Privacy: content-free warmup, no member IDs in inventory coordinator, binding validation before credentials and member-sensitive actions.

## Tasks

1. Obtain three independent scoped ReviewGPT implementation patches and capture exact response/artifact identity.
2. Integrate lifecycle, inventory, and configuration patches; remove accidental abstractions and reconcile shared interfaces.
3. Update private deployment forwarding if public environment contract changes, with matching verification.
4. Update architecture, reliability, security, deployment and local development owners to describe final behavior and migration.
5. Run focused tests, typechecks, complexity diff, privacy/diff checks, and direct applicable runtime proof.
6. Complete parent review and applicable final ReviewGPT/PR evidence; close the plan with a scoped commit when completed.

## Verification

- Inventory: two winners, excess contender, claim/reproof race, crash during initial preparation, bounded cleanup, mode/release changes and late completion.
- Lifecycle: cold/warm parity, foreground/background eligibility, no bind-timeout second target, retiring/foreign binding rejection, retained native warmth, legacy reference recovery and stop-before-successor guarantees.
- Configuration: global new fleet placement, conserved total capacity, transient legacy drain, target parsing, private forwarding and hosted-local fidelity.
- Run focused Cloudflare Vitest suites and Cloudflare typecheck; add hosted-local/package and private checks for the final touched owners.
- Measure deployed warm-hit rate, refill time, claim/bind timeout rates and foreground latency during an authorized rollout; local tests do not establish production capacity behavior.

## Progress

- Isolated task worktree created from current main; frozen dependencies installed.
- Independent ReviewGPT patch owners assigned for lifecycle, inventory, and deployment.
- Public baseline Cloudflare typecheck passed; lifecycle baseline 77 tests and coordinator baseline 19 tests passed.
- Private forwarding and rendered-fleet checks now use total capacity, an explicit legacy reservation, and the canonical ready target. The whole-release observer accepts zero-capacity legacy applications without weakening version/image/convergence checks.
- Private `pnpm verify` reached 699 passing tests with five local subprocess/Temporal timeouts. A sequential focused rerun passed 120 of 121 tests, including replay, recovery, fleet configuration, and zero-capacity convergence; one existing CLI subprocess deadline still expired under severe host load. Private typecheck passed after the changes. Remaining build/deploy-worker proof is running.
- All three exact ReviewGPT artifacts were integrated and independently inspected. Lifecycle, inventory, and deployment now share the unified global allocation contract; legacy namespace recovery remains isolated.
- Focused proof passed: inventory 49 tests; lifecycle/identity/write-fence 115 tests; full UserRunner orchestration 167 tests; native container 223 tests; transport recovery 29 tests; deployment 131 tests; hosted-local environment 99 tests and typecheck; Web ingress 234 tests after main reconciliation; changelog renderer 9 tests. Web typecheck passed after building its missing workspace dependency. Integrated Cloudflare typecheck passed after the final fixture correction.
- Removed obsolete Web member-prewarm producers and native operation/cancellation state. Authenticated compatibility receivers return bounded no-op results; historical telemetry DTOs remain readable.
- Complexity guard passed across 24 changed production source files. Native container, shared controller, and Web service complexity decreased; existing unrelated hotspots were inspected without extending the refactor into their established behavior.
- Private deployment companion is PR 116; its two required ReviewGPT gates are running concurrently with CI. Local source/typecheck and actual cross-repository forwarding proof pass. Automatic integration correctly rejects old public main until this public companion lands; private full verify CI passed on its exact head, covering the local host-load-sensitive subprocess timeout.
- Architecture, runtime, security, reliability, and both deployment owners now describe the final contract and migration. No live capacity settings or deployment were changed.
- Public runtime candidate is PR 2887. Existing conversation-readiness changelog item includes PR 2887 in its provenance; the final nine-test renderer rerun passed.

- Reconciled main at b10591f6840651bd143c1b8a17cda65bc98d0e36 before the first public final review. The sole conflict honored main's deletion of a redundant dispatch test; both webhook merges preserve the new terminal retry and this task's prewarm removal. Both app typechecks, 234 focused Web tests, 11 image-contract tests, and the complexity guard passed on the combined source.
- Final review tooling needs both unchanged canonical guarded snapshots. Initial private attempts were invalid because the configured model alias did not match the current Pro model; the final packet also lacked companion producer source. Correct per-run model selection and canonical two-snapshot staging retain preflight, capture identity, and one waited completion owner. The existing Pro-alias Frog entry covers model selection; the task-owned hosted-runtime-review entry records missing companion-snapshot support.

- Resumed the owned PR worktree at the reviewed head and reproduced both Cloudflare CI failures. Corrected isolated route and deletion fixtures for the shared binding lifecycle and exact-target retirement contract; production source is unchanged. Both full affected test files pass (139 tests), and Cloudflare typecheck passes after these corrections. Final public and private review captures retain their existing completion owners.
