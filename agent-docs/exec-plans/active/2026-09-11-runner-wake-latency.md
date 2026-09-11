# Restore prompt hosted replies after runner wake timeouts

Status: active
Created: 2026-09-11
Updated: 2026-09-11

## Goal

- Restore prompt end-to-end hosted replies after repeated runner wake timeouts,
  deploy the correction, and prove a real message receives a prompt reply.

## Success criteria

- Identify the failed wake substep using bounded production evidence.
- Reproduce and fix that transition, preserving exact-member write fencing.
- Pass focused tests, typecheck, required review/CI, and protected deployment.
- Measure real post-deploy admission and delivery on the intended size, including
  a subsequent wake, through user-authorized local messages to Murph.

## Scope

- In scope: the existing Cloudflare execution adapter, Temporal retry evidence,
  protected read-only diagnostics, and real reply verification.
- Out of scope: vault benchmarking, unrelated runtime changes, and rollback.

## Constraints

- Keep accepted-work durability, exact-target ownership, and foreground priority.
- Keep credentials in protected workflows and private evidence out of artifacts.
- User authorized protected investigation telemetry, fixes/deployment, and local
  test messages to Murph; no rollback is authorized.

## Risks and mitigations

1. A retry response omits its underlying failure, so a timeout change could mask
   the bug. Retrieve the existing structured Cloudflare failure stages first.
2. A late RPC may still own the container. Preserve write-fence and cleanup
   settlement invariants in any lifecycle correction.

## Tasks

1. Query existing Cloudflare wake logs through a bounded protected path.
2. Prove the failure in source and a synthetic reproduction, then correct its owner.
3. Run focused checks and complete required review and exact-head CI.
4. Deploy forward, verify convergence, and send real local test messages.

## Decisions

- Production evidence places the delay before runtime admission: repeated bounded
  ensure attempts returned retry_later while Temporal kept foreground work pending.
  Provider execution and delivery were fast after admission. The private runtime
  bundle confirms post-admission progress and is not copied into this repository.
- Reuse existing structured logs. Do not add a scheduler or persisted state owner.
- Give the selected-account application ten admission slots for immutable
  replacement targets. Keep the one-vCPU/three-GiB profile, disk, selector, and
  execution fence unchanged; this ceiling does not prewarm instances.
- Reuse the existing account-capacity guard before increasing an existing small
  application. Land the private validator first; it accepts the deployed capacity
  of one and the new capacity of ten during the cross-repository transition.

## Verification

- Eleven private diagnostic tests cover fixed query scope, closed output, streamed
  response bounds, cancellation, CLI errors, and protected workflow authority.
  Private full verification, final review, and exact-head CI passed; the
  protected diagnostic workflow is merged.
- Three existing startup-recovery tests passed for a late healthy start,
  caller-timeout fence preservation, and exhausted active-wake budgets. These
  narrow the investigation but do not reproduce or establish the incident cause.
- Focused public regression coverage passes: 152 tests across config rendering,
  native staging, capacity checks, resource budgets, and exact-member selection.
  Cloudflare typecheck and the complexity guard pass with no hotspots above 20.
- Private contract coverage accepts old/new capacities with enabled and retained
  profiles, while rejecting other capacities and resource changes. Full private
  verification is running; its 778-test coverage suite has passed.
- Required candidate review and CI are pending. Actual reply latency and resource
  identity remain required protected-deployment evidence.
