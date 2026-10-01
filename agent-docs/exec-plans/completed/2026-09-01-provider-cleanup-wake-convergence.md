# Provider cleanup wake convergence

Status: completed
Created: 2026-09-01
Updated: 2026-09-01

## Goal

- Stop a default runtime invocation from repeatedly handing control to a model-free system owner while its own due provider-cleanup wake keeps the dispatcher selecting the default owner.

## Success criteria

- A due provider-cleanup wake selected through the workspace's default-processing projection reaches the assistant cleanup lane even when an older model-free system wake is also due.
- Fresh conversation input and pending outbox delivery keep their existing foreground priority.
- The model-free system item remains durable and is serviced by its own subsequent owner invocation.
- A focused two-owner regression proves the default wake converges instead of recreating itself.

## Scope

- In scope: hosted assistant-phase wake arbitration and focused runtime scheduling tests.
- Out of scope: deploy receipt collection, device-sync implementation, provider cleanup semantics, or mailbox schema changes.

## Root-cause evidence

- Production typed logs show a repeated default invocation beginning immediately after successful outbound deliveries, with no new assistant pass completion.
- The workspace continually retains an older device-sync system wake while its default-processing wake is regenerated at each invocation timestamp.
- Provider cleanup is the only post-delivery default wake source that explicitly regenerates at the current timestamp while queued message identifiers remain.
- The assistant-phase owner selector hands the pass to the older model-free system wake before the provider cleanup plan can be prepared, while the dispatcher continues to select the still-due default projection.

## Plan

1. Add a focused regression with a due provider-cleanup checkpoint and an older model-free system wake.
2. Honor the selected due cleanup authority before model-free owner handoff without changing fresh-input or delivery priority.
3. Run focused runtime tests, package typecheck, complexity, diff/privacy review, and the focused real-Codex journey.
4. Complete exact-head review and CI, merge, deploy through the protected lane, and verify member and fleet convergence.

## Deployment concerns

- The runtime fix is Cloudflare-only and must wait for the independently owned protected-deploy receipt repair.
- No Web or Temporal compatibility change is required.
- Post-deploy proof must show the default projection clears, the system frontier advances, and invocation frequency returns to normal.

## Verification

- Passed: the focused provider-cleanup/model-free-owner regression first failed with zero cleanup-lane calls, then passed after the authority correction.
- Passed: all 86 hosted assistant foreground-phase tests.
- Passed: 26 focused provider-cleanup and prior device-owner handoff tests.
- Passed: assistant-runtime and assistant-engine package typechecks.
- Blocked: two focused real-Codex journey attempts failed in the pre-turn cache probe with zero provider actions and no reported token usage; the repository friction log records the harness failure.
- Pending: committed-head complexity, changelog source-PR registration, exact-head CI, final ReviewGPT, protected deployment, and production convergence proof.
Completed: 2026-09-01
