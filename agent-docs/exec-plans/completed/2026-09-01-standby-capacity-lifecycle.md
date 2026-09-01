# Standby Capacity Lifecycle Correction

## Outcome

Preserve the one-ready-slot standby experience without creating an application
capacity limit that can strand members whose claimed standby targets remain
bound across the ordinary per-member idle lifecycle.

## Proven constraint

`max_instances` applies to every running instance of a container application.
A claimed standby remains a `StandbyRunnerContainer`, and the coordinator
provisions a distinct replacement off-path. The application therefore needs
capacity for the ready slot plus every concurrently running bound claim; a
one-instance application cap is not a complete allocate-mode correction.

## Decision gate

- Prefer the existing lifecycle and capacity owner when an account quota change
  is sufficient and operationally available.
- Otherwise change code only if one existing container application can own both
  exact-user and standby targets without migrating or weakening member state.
- Reject small arbitrary standby caps or capacity partitions that can strand a
  previously bound member under concurrency.

## Decision

Keep the existing full-capacity standby application configuration. A static
split cannot preserve both exact-user and claimed-standby admission because a
claimed target remains permanently assigned to the standby application and can
wake again after physical idle. A one-instance cap fails on the first claim and
replacement; any larger finite split can fail after enough claimed members
return concurrently.

The account currently has no unallocated concurrent-vCPU capacity. The existing
architecture needs approximately 3,000 concurrent vCPU and 9 TiB concurrent
memory across the exact-user, standby, smoke, and preview applications. Raising
those account ceilings is the smallest complete correction; it adds no code,
state, scheduler, compatibility path, or capacity partition.

The attempted one-instance config change was kept local, proven incomplete,
and reversed before push. Production remains in canonical mode `off`.

## Verification

- Focused capacity/config assertions for the chosen ownership model.
- Existing standby claim, replenishment, retention, and exact-target cleanup
  tests.
- Affected package typechecks.
- Exact-head required GitHub checks before any merge.
- Protected deploy in `off` before any `shadow` observation.
- Cloudflare account-limit confirmation before the protected deploy is retried.

## Rollout

Keep production mode `off` until the application capacity model is complete
and the protected exact-version smoke passes. Do not run another ReviewGPT
round.
Status: completed
Updated: 2026-08-31
Completed: 2026-08-31
