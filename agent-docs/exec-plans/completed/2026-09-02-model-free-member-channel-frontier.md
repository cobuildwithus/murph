# Model-free member-channel frontier recovery

## Goal

Allow a deterministic `member.channels.updated` system-mailbox item to be
processed by the existing bounded model-free owner so it cannot strand newer
device-sync work behind the handled frontier.

## Root-cause proof

- Production reconciliation classified the first live retained system item as
  `default_owned` and repeatedly requested default processing.
- Repeated default invocations imported the complete system prefix but ran no
  device-sync work and did not advance the handled frontier.
- The runtime routes `member.channels.updated` to the existing deterministic
  `apply-member-channels-update` action, but that kind/action is absent from the
  model-free classifier and executor allowlist.
- Default processing applies channel updates only as a reply pre-dispatch
  barrier, so an idle default pass cannot consume the frontier item.

## Approach

1. Add a focused classifier regression and a production-shaped system-mailbox
   entrypoint test that fails before the correction.
2. Add the existing kind and route action to the shared model-free contract.
3. Keep the pre-dispatch channel barrier unchanged so a concurrent reply still
   observes the newest imported channel authority before provider delivery.
4. Update the hosted runtime protocol and changelog, run focused verification,
   then complete the normal PR, ReviewGPT, CI, merge, and deploy gates.

## Architecture and complexity

This reuses the existing classifier, route, executor, checkpoint, and handled
frontier. It adds no state, queue, scheduler, retry loop, mode, dependency, or
new abstraction.

## Verification

- Hosted-execution classifier test.
- Assistant-runtime system-mailbox entrypoint regression.
- Affected package typechecks.
- Required exact-head CI and ReviewGPT gates.

Status: completed
Updated: 2026-09-02
Completed: 2026-09-02
