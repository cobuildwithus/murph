# Restore prompt hosted replies after runner wake timeouts

Status: completed
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
  verification and required CI passed; final and preliminary specialist reviews
  passed. The private compatibility change merged as PR #135.
- Public final review round one identified invalid rollout-step arrays when a
  worker-only deployment retains the old smaller native capacity. The parent
  accepted the finding and the user resumed remediation. The existing retention
  owner now trims arrays to retained capacity while preserving numeric steps and
  omitting steps for zero capacity; no new owner or abstraction was introduced.
- The renderer-to-staging regression failed for retained capacities one and two
  before correction. All 66 focused staging/config/CLI tests pass afterward;
  the 12 small-runner tests also pass the pinned Wrangler config parser directly.
  Cloudflare typecheck and the complexity guard pass.
- Required public CI exposed a fixed-date canary fixture aging past 24 hours.
  A focused run reproduced ten failures. The matching upstream fixture fix and
  Frog entry already exist on main and were incorporated by base reconciliation.
- Public round two passed with matching model evidence. All required final-head
  CI passed, and public PR #3278 merged after the private compatibility change.
- The protected deployment selected the exact merged public candidate. Its Node
  shard failed three bundle fixtures because the private workflow did not build
  runtime-state timing exports; public Host Support and release CI already do.
  Private PR #136 adds that same prerequisite before each Node shard. The public
  build plus all 17 bundle tests pass, along with private typecheck and 28 workflow
  tests. Full private verification, exact-head CI, and both reviews passed; the
  prerequisite fix merged. Subsequent protected attempts kept all predeploy
  gates enabled.
- Both protected attempts timed out in the synthetic image-reminder checkpoint-race
  journey; every other gate passed in the second attempt. A local reproduction
  read only the image tool result and proved that the default Starter seed lacks
  the subscription required for image generation. The entitlement rejection is
  correct; the positive image fixtures need an explicit paid seed. The scheduled
  image reminder and generated-image delivery fixtures now use the existing seed's
  paid plan and synthetic subscription fields. The corrected reminder replay passes
  all three selected tests, and generated-image delivery passes all three tests.
  Cloudflare typecheck and complexity checks pass. Public PR #3289 merged with
  every required check green. No gate was bypassed, and neither failed attempt
  changed production state.
- The third protected deployment passed every predeployment gate against the
  merged fixture correction, including all three selected image-reminder tests.
  Protected run 34622940410 deployed public commit
  d207c45d87f755a7c4c46e2ec304799812982ad6 with private commit
  e71eae83887625cf337e7e8522148bfd34032ad2. Live smoke and release
  convergence passed. The observed small application has a capacity ceiling
  of ten and a completed rollout; 100% of Worker traffic serves this release.
  The generated configuration passed the one-vCPU/three-GiB resource validator.
- Authorized real-message proof shows initial post-deploy admission around eight
  seconds and delivery around 25 seconds, compared with previous admission waits
  of roughly 153–156 seconds. A warm follow-up delivered in roughly five seconds.
  After ten minutes without a new message, a subsequent reply delivered in
  roughly eight seconds on a different runner attempt. That attempt was admitted
  shortly before message acceptance, so the trace does not yield a cold-admission
  duration for this last message. The previous multi-minute admission stall did
  not recur in either observed new attempt.

## Outcome

- Ready: the protected production rollout converged and real replies recovered.
- Selected-account routing, the one-vCPU/three-GiB resource profile, disk, and
  exact-attempt write fencing remain intact. The higher capacity ceiling admits
  immutable replacements while the provider releases retired targets; it does
  not prewarm ten runners.
- Public PRs #3278 and #3289 and private PRs #135 and #136 are merged. Required
  implementation reviews and exact-head checks passed. The final record-only
  closure changes no runtime behavior and follows the docs-only review exemption.
- These observations prove the tested recovery and subsequent new attempt, not
  a latency guarantee for every future turn. No rollback was performed.
Completed: 2026-09-11
