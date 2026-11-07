# Use normal container readiness for standby inventory

Status: completed
Created: 2026-09-23
Updated: 2026-09-23

## Outcome and owner

Standby inventory uses RunnerContainer's ordinary startup and health path. Remove
its disposable Codex shell probe and extra hydration-complete admission gate.
Preserve exact image/release identity, healthy unused inventory, immutable binding,
bounded refill, and durable recovery. No schema, capacity, or provider-input change.

## Evidence and design

Normal startup already starts heavy runtime hydration in the background and real
invocation joins that promise. Standby alone launches a throwaway Codex process,
checks its shell, kills it, then requires preflight completion before publishing.
Delete this duplicate per-instance software validation and the readiness-only scope.
Keep full deployment smoke. Retain its existing health receipt fields because the
deployed preceding Worker consumes them during Worker/container version skew.

## Product UX: Patch

Nearby conversations can obtain replenished slots sooner without another child
process or a second startup policy. Pending hydration is allowed as for ordinary
containers; actual invocation still waits for hydration. Claimed or used slots never
return to inventory. No live latency claim is made before deployment observation.

## Tasks and proof

1. Remove standby smoke dispatch and preflight/hydration admission requirements.
2. Delete the readiness scope; prove legacy scoped requests still run full smoke.
3. Prove cold and running ordinary containers become standby inventory without
   smoke, including pending hydration; preserve identity, busy, poison and use gates.
4. Update current owner docs and existing startup-delay changelog provenance.
5. Run focused tests, relevant typechecks, complexity and parent review; open a
   follow-up PR and complete final ReviewGPT plus required exact-head CI.

## Deployment

New Worker/old container skips smoke and uses existing health. Old Worker/new
container sends its readiness query; the unchanged pathname route ignores the query
and runs full smoke, publishing the same legacy receipt. No new compatibility owner
or data migration. Normal rollout can proceed in either order; rollback restores
extra validation without changing durable state.

## Verification and parent review

- 248 tests pass across standby-runner, runner-fleet-lifecycle, container-entrypoint,
  and smoke-hosted-deploy in the Cloudflare Node workspace. Cloudflare typecheck passes.
- The two ordinary-health regressions fail against the base RunnerContainer because
  it dispatches the removed shell smoke; the candidate passes for running and stopped
  native containers with hydration pending, using two health reads and no smoke.
- Existing HTTP proof confirms real invocation waits for the one hydration promise;
  failed hydration poisons the container. Identity, use, binding and retirement
  regressions pass. Legacy query/default deployment smoke retain full CLI behavior
  and publish the old health receipt on success.
- Complexity guard passes with unchanged hotspots; runtime source is a net deletion
  of 39 lines. No new abstraction, dependency, state owner, polling loop or provider call.
- Product UX: Ready. The foreground path, actual Codex execution and delivery are
  unchanged; real latency improvement requires post-deployment observation.
- Changelog: group this follow-up under the existing startup-delay item; record its
  PR provenance before final review. Required exact-head CI and ReviewGPT run in the
  PR lane after this scoped implementation commit. No production mutation performed.
Completed: 2026-09-23
