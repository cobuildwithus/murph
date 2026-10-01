# One-slot ENAM warm-standby experiment

Status: completed
Created: 2026-08-30
Updated: 2026-08-31

## Goal

- Reduce eligible ENAM members' cold accepted-to-runner and accepted-to-provider
  latency by provisioning one pristine release-scoped runner shell, while
  preserving the exact-user cold path, per-member write-fence authority,
  provider-credential binding, and exact withdrawal/account-deletion stops.
- Treat the standby as a removable experiment rather than a generalized pool.

## Success criteria

- At most one unclaimed release-scoped ENAM slot can be advertised ready, and
  only after exact release/bundle/architecture and completed heavy-runtime
  readiness are proved.
- Claiming and binding share a 250 ms deadline. A miss before ownership uses
  the existing exact-user cold fallback; an ambiguous bind after the exact stop
  target is reserved yields for safe retry. Replenishment never runs on the
  accepted-message critical path.
- A slot binds exactly once to one member and one claim, is never returned to
  ready, and uses the ordinary member idle lifecycle after activation.
- UserRunner remains the sole member execution authority and persists the
  claimed slot before binding, then carries that exact target through its
  write fence and cleanup lifecycle.
- Provider egress, invocation, workspace restore, withdrawal, and account
  deletion prove the exact member plus opaque claimed container name; ambiguous
  ownership burns/retires the slot instead of reusing it.
- `off`, `shadow`, and `allocate` modes are explicit, release-safe, and
  reversible without changing the exact-user path.
- Content-free telemetry separates claimed, retained, disabled, and fallback
  container selection while existing startup telemetry measures the latency.
- Focused deterministic state-machine, binding, release, fallback,
  provider-fence, user-control cleanup, readiness, and deployment-contract
  tests pass with the Cloudflare build/typecheck and required exact-head CI.
- Product UX Patch walkthrough is Ready for an eligible cold member, a second
  concurrent/fallback member, and a member withdrawing or deleting data.

## Scope

- In scope:
  - One coordinator for the exact container application, release identity, and
    ENAM experiment region.
  - Opaque never-reused slot identities; immutable one-way slot binding;
    bounded memberless coordinator tombstones; exact UserRunner stop targets.
  - Heavy-runtime-complete standby readiness; one replacement provisioning at
    a time; alarm/event-driven re-proving and bounded backoff.
  - Off, shadow-readiness, and allocation modes, explicit abort switch,
    selection telemetry, and experiment activation/retirement docs.
  - Exact claimed-target lifecycle integration with write fences, invocation,
    provider credentials, withdrawal, account deletion, poison, idle cleanup,
    restart, and rollout.
  - Focused local and composed production-path proof plus deploy documentation.
- Out of scope:
  - More than one ready slot, multi-region or cross-region allocation, a
    generalized fleet/autoscaler, random routing, or a new work scheduler.
  - Reusing a claimed shell for another person or keeping claimed shells alive
    beyond the existing per-member idle lifecycle.
  - Reusing deploy-smoke containers or changing canonical workspace semantics.
  - Removing the existing typing/message shell hints in this experiment.
  - Claiming permanent latency gains before controlled production evidence.

## Constraints

- Technical constraints:
  - Warm reuse is optimization only; write-fence and live owner checks remain
    authority.
  - Durable Object transactions cannot span coordinator, slot, and UserRunner;
    use one-way transitions, idempotent claim identity, bounded tombstones, and
    terminal retirement for ambiguity.
  - Do not parse opaque slot names as member identity or mint member/provider
    authority before immutable binding.
  - Durable binding survives process replacement while disk does not; every
    restarted process must re-prove readiness and restore only for its bound
    member.
  - Exact Worker release and container bundle/source fingerprints scope both
    coordinator identity and readiness; mixed rollout must fail closed or use
    the unchanged exact-user fallback.
  - Persist only operational coordination state with explicit schema/migration
    seams; no canonical or user-queryable product truth lives in the standby.
  - No production secret values or production writes are required locally.
- Product/process constraints:
  - Product UX effort: Patch.
  - Outcome: eligible ENAM cold messages can begin provider work materially
    sooner when the one slot is ready.
  - Reaches: ordinary fresh hosted-runtime starts; same-member warm reuse and
    no-ready/failure journeys retain existing behavior.
  - Proof: production-shaped composed tests plus content-free timing cohorts;
    operational adoption still requires the review's latency, reliability,
    ready-coverage, user-control, and cost gates.
  - Use an isolated task worktree, preserve the overlapping exact-user prewarm
    PR, commit through finish-task, open a draft PR, run preliminary specialist
    and final ReviewGPT concurrently with CI, and keep the worktree while open.

## Risks and mitigations

1. Risk: Cross-member workspace, credential, or invocation reuse.
   Mitigation: opaque explicit routing identity, immutable bind-once slot state,
   exact active-fence validation, never-reuse retirement, and mismatch quarantine.
2. Risk: Crash gaps orphan a bound slot or lose a cleanup target.
   Mitigation: atomically claim only an opaque slot, persist that exact target
   before bind, keep coordinator claim-to-slot tombstones, resolve idempotently,
   retain ambiguous targets, and expire unactivated claims into retirement.
3. Risk: Withdrawal or account deletion acknowledges while a claimed target
   remains live or unknown.
   Mitigation: serialize behind UserRunner, collect the deduplicated exact fence,
   mapped slot, pending-resolved slot, and independently relevant deterministic
   target; retain revocation and retry on ambiguous stop.
4. Risk: A healthy endpoint is advertised before expensive hydration or after
   rollout/restart drift.
   Mitigation: separate standby readiness from basic health and require release,
   fingerprints, completed hydration, pristine process, unbound state, and region.
5. Risk: Optional allocation regresses foreground latency or availability.
   Mitigation: hard 250 ms claim/bind deadline, no caller wait for
   replenishment, exact-user fallback before ownership, safe exact-target retry
   after an ambiguous bind, shadow mode first, and immediate abort switch.
6. Risk: Complexity outlives a failed experiment.
   Mitigation: isolate standby owners and readiness surface, document measurable
   adoption/removal gates, and avoid generalized fleet abstractions.

## Tasks

1. Read current hosted-runtime, security, reliability, deploy, Cloudflare
   Containers/Durable Objects, and test-owner contracts; map every existing
   identity, fence, readiness, stop, restart, and cleanup path.
2. Confirm current official Cloudflare lifecycle, placement, container-instance,
   Durable Object storage/alarm, migration, rollout, and testing APIs; record
   only the exact primitives used.
3. Design the smallest release-scoped coordinator/slot/UserRunner protocol and
   typed routing identity against current code, including all crash gaps,
   deadlines, tombstone retention, alarm backoff, and deployment skew.
4. Implement explicit standby configuration and modes, coordinator and slot
   state, full standby readiness including Codex initialize/stop, bounded
   claim/activation/recovery, exact-user fallback, replenishment, retirement,
   and content-free observability.
5. Integrate exact claimed targets with invocation, provider fences, idle/poison
   cleanup, health-data withdrawal, account deletion, restart, and release drain.
6. Add focused owner tests covering shadow readiness, successful claim,
   concurrent no-ready fallback, persisted-before-bind recovery, member
   mismatch rejection, same-member retention, user-control cleanup, rollout
   configuration, and permanent non-reuse.
7. Update live architecture/security/reliability/runtime/deploy docs. Do not
   publish a member-visible changelog while the source-controlled mode is off.
8. Run focused verification and Product UX walkthrough, inspect scope/diff, then
   commit/push the candidate and open the required draft PR.
9. Launch preliminary specialist and final ReviewGPT gates concurrently with CI,
   disposition every finding, remediate accepted issues, rerun focused proof,
   complete parent final review, close the plan with finish-task, and prove a
   clean current-base merge tree.

## Decisions

- Implement one release-scoped ENAM standby; reject a global, multi-slot,
  multi-region, random, reusable, or deploy-smoke pool.
- UserRunner remains the sole per-member authority; the coordinator owns only
  availability/replenishment and the slot owns only immutable physical binding.
- Treat ambiguous post-reservation claim state as exact-target retry, then
  retire the slot and use the exact-user fallback once ownership is resolved;
  do not add reusable cross-member recovery machinery.
- Keep the overlapping message-routing shell prewarm as a separate advisory
  exact-user hint; this experiment does not adopt it as pool admission authority.

## Verification

- Commands:
  - Focused Vitest suites for standby coordination, UserRunner identity/fences,
    RunnerContainer lifecycle, entrypoint health, deployment config/artifacts,
    and scheduled bootstrap.
  - `pnpm --dir apps/cloudflare typecheck` and the package's focused verify/build
    commands required by the verification map.
  - `git diff --check`, architecture/doc drift checks, and required exact-head CI.
- Expected outcomes:
  - All focused deterministic checks pass with no new secret/private output.
  - Direct proof shows one-time binding, no cross-member reuse, bounded fallback,
    exact stop targeting, release-scoped readiness, and replenishment off-path.
  - Operational rollout remains gated on shadow evidence and production metrics;
    local proof does not claim the latency or cost acceptance gates themselves.
Completed: 2026-08-31
